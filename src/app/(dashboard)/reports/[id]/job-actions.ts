"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dateInPHT, todayISO } from "@/lib/aggregate";
import { getApproverNameOptions, getCurrentProfile, isSupervisor, requireSupervisor } from "@/lib/profile";
import {
  contactedVendorsFromForm,
  jobFieldsFromForm,
  strOrNull,
  upsertReportForDate,
  validateCoreRequiredFields,
  validateEtaUpdatedOnDispatch,
  validateNewJobRequiredFields,
  validatePendingCompletionSubstatus,
  validateTimeDispatchedRequired,
  validateUniqueJobNumber,
  validateGoaAmount,
  validateContactedVendorsGoaAmounts,
  isCancelledJobStatus,
  isCompletedJobStatus,
  isPendingCompletionStatus,
} from "./job-fields";
import { findOrCreateLeadForJob } from "@/lib/leadMatching";

type ActionResult = { success: true; id?: string } | { error: string };

// Basic structure for now (per the plan, ahead of the Vendor Map integration):
// replace the job's whole contacted-vendors row set with whatever was
// submitted, rather than diffing — simplest correct sync for a client-managed
// repeatable row group.
type ContactedRows = ReturnType<typeof contactedVendorsFromForm>;

// Checks the submitted Contacted Vendors against the Vendors directory — the
// directory, not the browser, decides each linked vendor's tier:
//   - DNC Tier 3 vendors are excluded from dispatch and can never be added.
//   - DNC Tier 1 / 2 vendors need a team leader's approval on the row.
// Returns the rows to save (with the tier filled in from the directory).
async function prepareContactedVendors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData
): Promise<{ error: string } | { rows: ContactedRows }> {
  const rows = contactedVendorsFromForm(formData);

  const goaError = validateContactedVendorsGoaAmounts(rows);
  if (goaError) return { error: goaError };

  const ids = Array.from(new Set(rows.map((r) => r.vendor_id).filter((id): id is string => !!id)));
  const tiers = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await supabase.from("vendors").select("id, tier").in("id", ids);
    if (error) return { error: error.message };
    for (const v of data ?? []) tiers.set(v.id, v.tier);
  }

  let approvers: string[] | null = null;
  const prepared: ContactedRows = [];
  for (const row of rows) {
    const tier = row.vendor_id ? (tiers.get(row.vendor_id) ?? null) : null;
    const label = row.vendor_name ?? "this vendor";
    if (row.vendor_id && tier === null) {
      return { error: `${label} is no longer in the Vendors directory — remove the row or clear the link.` };
    }
    if (tier === "dnc_tier_3") {
      return { error: `${label} is DNC Tier 3 and excluded from dispatch. Remove it from Contacted Vendors.` };
    }
    let tl_approved_by = row.tl_approved_by;
    if (tier === "dnc_tier_1" || tier === "dnc_tier_2") {
      if (!tl_approved_by) {
        return { error: `${label} is ${tier === "dnc_tier_1" ? "DNC Tier 1" : "DNC Tier 2"} — select the team leader who approved using them.` };
      }
      approvers ??= await getApproverNameOptions();
      if (!approvers.includes(tl_approved_by)) {
        return { error: `${tl_approved_by} isn't a team leader or admin, so they can't approve ${label}.` };
      }
    } else {
      tl_approved_by = null;
    }
    prepared.push({ ...row, vendor_tier: tier, tl_approved_by });
  }
  return { rows: prepared };
}

async function syncContactedVendors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  formData: FormData
): Promise<string | null> {
  const prepared = await prepareContactedVendors(supabase, formData);
  if ("error" in prepared) return prepared.error;
  const rows = prepared.rows;

  const { error: deleteError } = await supabase
    .from("job_contacted_vendors")
    .delete()
    .eq("job_id", jobId);
  if (deleteError) return deleteError.message;

  if (rows.length === 0) return null;

  const { error: insertError } = await supabase
    .from("job_contacted_vendors")
    .insert(rows.map((r) => ({ ...r, job_id: jobId })));
  if (insertError) return insertError.message;

  return null;
}

export async function getOrCreateTodaysReport(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const resolved = await upsertReportForDate(supabase, user.id, todayISO());
  if ("error" in resolved) return resolved;

  revalidatePath("/");
  return { success: true, id: resolved.id };
}

export async function createJob(reportId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const fields = jobFieldsFromForm(formData);

  const coreError = validateCoreRequiredFields(fields);
  if (coreError) return { error: coreError };

  const newJobError = validateNewJobRequiredFields(fields);
  if (newJobError) return { error: newJobError };

  const duplicateJobNumberError = await validateUniqueJobNumber(supabase, fields.job_number);
  if (duplicateJobNumberError) return { error: duplicateJobNumberError };

  const timeDispatchedError = validateTimeDispatchedRequired(
    fields.job_status,
    fields.time_dispatched
  );
  if (timeDispatchedError) return { error: timeDispatchedError };

  const substatusError = validatePendingCompletionSubstatus(
    fields.job_status,
    fields.pending_completion_substatus
  );
  if (substatusError) return { error: substatusError };

  const goaError = validateGoaAmount(fields.goa, fields.goa_amount);
  if (goaError) return { error: goaError };

  const vendorsCheck = await prepareContactedVendors(supabase, formData);
  if ("error" in vendorsCheck) return { error: vendorsCheck.error };

  const profile = await getCurrentProfile();
  if (!isSupervisor(profile?.role)) {
    if (!profile?.agent_name) {
      return { error: "Your account isn't linked to an agent name — ask an admin to fix your profile." };
    }
    if (fields.agent !== profile.agent_name) {
      return { error: "You can only create jobs under your own name." };
    }
  }

  // A job counts toward the day it was dispatched, not the day it was added —
  // if a dispatch time is already known, file it under that date's report.
  let targetReportId = reportId;
  if (fields.time_dispatched) {
    const resolved = await upsertReportForDate(supabase, user.id, dateInPHT(fields.time_dispatched));
    if ("error" in resolved) return { error: resolved.error };
    targetReportId = resolved.id;
  }

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", targetReportId);

  const { data: inserted, error } = await supabase
    .from("jobs")
    .insert({
      ...fields,
      report_id: targetReportId,
      row_number: (count ?? 0) + 1,
      source: "manual",
      created_by: user.id,
      pending_completion_at: isPendingCompletionStatus(fields.job_status)
        ? new Date().toISOString()
        : null,
      completed_at: isCompletedJobStatus(fields.job_status) ? new Date().toISOString() : null,
      cancelled_at: isCancelledJobStatus(fields.job_status) ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (inserted?.id) {
    const vendorsError = await syncContactedVendors(supabase, inserted.id, formData);
    if (vendorsError) return { error: vendorsError };

    // Every new job must end up linked to a Lead — either the one explicitly
    // picked in the Client Details "load from an existing lead" selector, or
    // (if none was picked) whichever lead matches this job's phone/email/
    // name, creating one if nothing matches. This is the only place jobs get
    // created outside convertLeadToJob (which already sets lead_id directly
    // since it's converting a specific, known lead) — if a new job-creation
    // path is ever added elsewhere, it must call findOrCreateLeadForJob too.
    const explicitLeadId = strOrNull(formData.get("selected_lead_id"));
    const leadResult = explicitLeadId
      ? { leadId: explicitLeadId }
      : await findOrCreateLeadForJob(supabase, {
          customerName: fields.customer_name,
          customerPhone: fields.customer_phone,
          email: fields.client_email,
          agent: fields.agent,
          dispatcher: fields.dispatcher,
          state: fields.state,
          jobId: inserted.id,
          jobTimeConverted: fields.time_converted,
        });
    if ("leadId" in leadResult) {
      const { error: linkError } = await supabase
        .from("jobs")
        .update({ lead_id: leadResult.leadId })
        .eq("id", inserted.id);
      if (linkError) console.error(`Failed to link job ${inserted.id} to lead ${leadResult.leadId}:`, linkError.message);
    } else {
      console.error(`Failed to find/create a lead for job ${inserted.id}:`, leadResult.error);
    }
  }

  revalidatePath(`/reports/${targetReportId}`);
  if (targetReportId !== reportId) revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true, id: inserted?.id };
}

type JobContext =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      reportId: string;
      currentAgent: string | null;
      currentStatus: string | null;
      currentEtaMinutes: number | null;
      currentPendingCompletionAt: string | null;
      currentCompletedAt: string | null;
      currentCancelledAt: string | null;
    }
  | { ok: false; error: string };

async function requireJobContext(jobId: string): Promise<JobContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: existing, error } = await supabase
    .from("jobs")
    .select("report_id, agent, job_status, eta_minutes, pending_completion_at, completed_at, cancelled_at")
    .eq("id", jobId)
    .single();

  if (error || !existing) return { ok: false, error: "Job not found." };

  return {
    ok: true,
    supabase,
    reportId: existing.report_id as string,
    currentAgent: existing.agent,
    currentStatus: existing.job_status,
    currentEtaMinutes: existing.eta_minutes,
    currentPendingCompletionAt: existing.pending_completion_at,
    currentCompletedAt: existing.completed_at,
    currentCancelledAt: existing.cancelled_at,
  };
}

export async function updateJob(jobId: string, formData: FormData): Promise<ActionResult> {
  const check = await requireJobContext(jobId);
  if (!check.ok) return { error: check.error };
  const {
    supabase,
    reportId,
    currentAgent,
    currentStatus,
    currentEtaMinutes,
    currentPendingCompletionAt,
    currentCompletedAt,
    currentCancelledAt,
  } = check;

  const fields = jobFieldsFromForm(formData);

  const coreError = validateCoreRequiredFields(fields);
  if (coreError) return { error: coreError };

  const duplicateJobNumberError = await validateUniqueJobNumber(supabase, fields.job_number, jobId);
  if (duplicateJobNumberError) return { error: duplicateJobNumberError };

  const timeDispatchedError = validateTimeDispatchedRequired(
    fields.job_status,
    fields.time_dispatched
  );
  if (timeDispatchedError) return { error: timeDispatchedError };

  const etaUpdatedError = validateEtaUpdatedOnDispatch(
    currentStatus,
    fields.job_status,
    currentEtaMinutes,
    fields.eta_minutes
  );
  if (etaUpdatedError) return { error: etaUpdatedError };

  const substatusError = validatePendingCompletionSubstatus(
    fields.job_status,
    fields.pending_completion_substatus
  );
  if (substatusError) return { error: substatusError };

  const goaError = validateGoaAmount(fields.goa, fields.goa_amount);
  if (goaError) return { error: goaError };

  const vendorsCheck = await prepareContactedVendors(supabase, formData);
  if ("error" in vendorsCheck) return { error: vendorsCheck.error };

  const profile = await getCurrentProfile();
  if (!isSupervisor(profile?.role)) {
    if (!profile?.agent_name) {
      return { error: "Your account isn't linked to an agent name — ask an admin to fix your profile." };
    }
    if (currentAgent !== profile.agent_name) {
      return { error: "You can only edit jobs assigned to you." };
    }
    if (fields.agent !== profile.agent_name) {
      return { error: "You can only assign jobs to yourself." };
    }
  }

  const pending_completion_at = isPendingCompletionStatus(fields.job_status)
    ? isPendingCompletionStatus(currentStatus) && currentPendingCompletionAt
      ? currentPendingCompletionAt
      : new Date().toISOString()
    : null;

  const completed_at = isCompletedJobStatus(fields.job_status)
    ? isCompletedJobStatus(currentStatus) && currentCompletedAt
      ? currentCompletedAt
      : new Date().toISOString()
    : null;

  const cancelled_at = isCancelledJobStatus(fields.job_status)
    ? isCancelledJobStatus(currentStatus) && currentCancelledAt
      ? currentCancelledAt
      : new Date().toISOString()
    : null;

  // A job counts toward the day it was dispatched, not the day it was
  // created or converted — whenever the dispatch time changes, move the job
  // to that date's report so it's reflected everywhere.
  let targetReportId = reportId;
  let row_number: number | undefined;
  if (fields.time_dispatched) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not signed in." };

    const resolved = await upsertReportForDate(supabase, user.id, dateInPHT(fields.time_dispatched));
    if ("error" in resolved) return { error: resolved.error };
    targetReportId = resolved.id;

    if (targetReportId !== reportId) {
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("report_id", targetReportId);
      row_number = (count ?? 0) + 1;
    }
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      ...fields,
      pending_completion_at,
      completed_at,
      cancelled_at,
      ...(targetReportId !== reportId ? { report_id: targetReportId, row_number } : {}),
    })
    .eq("id", jobId);

  if (error) return { error: error.message };

  const vendorsError = await syncContactedVendors(supabase, jobId, formData);
  if (vendorsError) return { error: vendorsError };

  revalidatePath(`/reports/${targetReportId}`);
  if (targetReportId !== reportId) revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

export async function deleteJob(jobId: string): Promise<ActionResult> {
  const supervisorCheck = await requireSupervisor();
  if (!supervisorCheck.ok) return { error: supervisorCheck.error };

  const check = await requireJobContext(jobId);
  if (!check.ok) return { error: check.error };
  const { supabase, reportId } = check;

  const { error } = await supabase.from("jobs").delete().eq("id", jobId);

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

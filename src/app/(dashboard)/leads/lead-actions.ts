"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dateInPHT } from "@/lib/aggregate";
import { getCurrentProfile, isSupervisor, requireSupervisor } from "@/lib/profile";
import { LEAD_DISPOSITIONS, QUOTE_STATUSES, type QuoteStatus } from "@/lib/constants";
import { intakeFieldsFromForm } from "@/lib/intake";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadMatching";
import { numberOrNull } from "@/lib/formParse";
import {
  jobFieldsFromForm,
  strOrNull,
  upsertReportForDate,
  validateCoreRequiredFields,
  validateNewJobRequiredFields,
  validatePendingCompletionSubstatus,
  validateTimeDispatchedRequired,
  validateUniqueJobNumber,
  isCancelledJobStatus,
  isCompletedJobStatus,
  isPendingCompletionStatus,
} from "../reports/[id]/job-fields";

type ActionResult = { success: true } | { error: string };

function leadFieldsFromForm(formData: FormData) {
  const { client_email, ...intake } = intakeFieldsFromForm(formData);
  const customerPhone = intake.customer_phone;

  return {
    ...intake,
    agent: strOrNull(formData.get("agent")),
    dispatcher: strOrNull(formData.get("dispatcher")),
    source: strOrNull(formData.get("source")),
    notes: strOrNull(formData.get("notes")),
    // Leads call it `email`; jobs call it `client_email`.
    email: client_email,
    quoted_price: numberOrNull(formData.get("quoted_price")),
    // Kept in sync so customer matching (phone → email → name) finds leads
    // created by hand, not just the ones auto-created from jobs.
    phone_normalized: normalizePhone(customerPhone),
    email_normalized: normalizeEmail(client_email),
    name_normalized: normalizeName(intake.customer_name),
  };
}

// A lead can be saved mid-call with almost nothing filled in — it just can't
// be completely empty.
function leadHasAnyContent(fields: ReturnType<typeof leadFieldsFromForm>): boolean {
  return [
    fields.job_type,
    fields.customer_name,
    fields.customer_phone,
    fields.service_street_address,
    fields.service_city,
    fields.vehicle_year,
    fields.vehicle_make,
    fields.vehicle_model,
    fields.issue,
    fields.quoted_price,
  ].some((v) => v !== null && v !== undefined);
}

async function requireLeadPermission(agent: string | null): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (isSupervisor(profile?.role)) return null;
  if (!profile?.agent_name) {
    return "Your account isn't linked to an agent name — ask an admin to fix your profile.";
  }
  if (agent !== profile.agent_name) {
    return "You can only manage leads assigned to your own name.";
  }
  return null;
}

function revalidateLeads(leadId?: string) {
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

async function requireLead(supabase: Awaited<ReturnType<typeof createClient>>, leadId: string) {
  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", leadId).single();
  if (error || !lead) return { ok: false as const, error: "Lead not found." };
  return { ok: true as const, lead };
}

export type SaveLeadIntent = "save" | "quote" | "accepted" | "declined" | "follow_up";

type SaveLeadResult = { success: true; id: string; leadNumber: string } | { error: string };

// Create-or-update for the guided workflow. `intent` records what the agent
// just did on the Pricing step; "declined" also closes the lead out as lost.
export async function saveLead(
  leadId: string | null,
  formData: FormData,
  intent: SaveLeadIntent
): Promise<SaveLeadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const fields = leadFieldsFromForm(formData);
  if (!leadHasAnyContent(fields)) {
    return { error: "Enter at least a service type, customer, vehicle, or location before saving." };
  }

  let existing: { agent: string | null; status: string; quote_status: string | null } | null = null;
  if (leadId) {
    const check = await requireLead(supabase, leadId);
    if (!check.ok) return { error: check.error };
    if (check.lead.status !== "open") return { error: "Only an open lead can be edited." };
    existing = check.lead;
    const ownerError = await requireLeadPermission(check.lead.agent);
    if (ownerError) return { error: ownerError };
  }
  const permissionError = await requireLeadPermission(fields.agent);
  if (permissionError) return { error: permissionError };

  const posted = strOrNull(formData.get("quote_status"));
  const previous: QuoteStatus =
    posted && (QUOTE_STATUSES as readonly string[]).includes(posted)
      ? (posted as QuoteStatus)
      : ((existing?.quote_status as QuoteStatus | null) ?? "quoting");
  const quote_status: QuoteStatus =
    intent === "quote"
      ? "quoted"
      : intent === "accepted"
        ? "accepted"
        : intent === "declined"
          ? "declined"
          : intent === "follow_up"
            ? "follow_up"
            : previous;

  const row = {
    ...fields,
    quote_status,
    ...(intent === "declined"
      ? { status: "lost", disposition: "Customer Declined", disposition_at: new Date().toISOString() }
      : {}),
  };

  const query = leadId
    ? supabase.from("leads").update(row).eq("id", leadId)
    : supabase.from("leads").insert({ ...row, created_by: user.id });
  const { data, error } = await query.select("id, lead_number").single();

  if (error || !data) return { error: error?.message ?? "Failed to save the lead." };
  revalidateLeads(data.id);
  return { success: true, id: data.id, leadNumber: data.lead_number };
}

export async function markLeadLost(leadId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const check = await requireLead(supabase, leadId);
  if (!check.ok) return { error: check.error };
  if (check.lead.status !== "open") return { error: "Only an open lead can be marked lost." };

  const permissionError = await requireLeadPermission(check.lead.agent);
  if (permissionError) return { error: permissionError };

  const disposition = strOrNull(formData.get("disposition"));
  if (!disposition || !LEAD_DISPOSITIONS.includes(disposition)) {
    return { error: "Select a reason the lead didn't convert." };
  }
  const disposition_notes = strOrNull(formData.get("disposition_notes"));

  const { error } = await supabase
    .from("leads")
    .update({
      status: "lost",
      disposition,
      disposition_notes,
      disposition_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) return { error: error.message };
  revalidateLeads(leadId);
  return { success: true };
}

export async function reopenLead(leadId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const check = await requireLead(supabase, leadId);
  if (!check.ok) return { error: check.error };
  if (check.lead.status !== "lost") return { error: "Only a lost lead can be reopened." };

  const permissionError = await requireLeadPermission(check.lead.agent);
  if (permissionError) return { error: permissionError };

  const { error } = await supabase
    .from("leads")
    .update({ status: "open", disposition: null, disposition_notes: null, disposition_at: null })
    .eq("id", leadId);

  if (error) return { error: error.message };
  revalidateLeads(leadId);
  return { success: true };
}

export async function deleteLead(leadId: string): Promise<ActionResult> {
  const supervisorCheck = await requireSupervisor();
  if (!supervisorCheck.ok) return { error: supervisorCheck.error };

  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) return { error: error.message };

  revalidateLeads();
  return { success: true };
}

type ConvertResult = { success: true; reportId: string; jobId: string } | { error: string };

// Runs a Lead through the exact same required-field / uniqueness / dispatch
// validation as creating a Job directly (see job-fields.ts), then carries the
// Lead's customer/agent info onto the new Job and links the two records both
// ways so the full inquiry-to-job history stays intact.
export async function convertLeadToJob(leadId: string, formData: FormData): Promise<ConvertResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const check = await requireLead(supabase, leadId);
  if (!check.ok) return { error: check.error };
  const lead = check.lead;
  if (lead.status !== "open") return { error: "This lead has already been converted or closed." };

  const fields = jobFieldsFromForm(formData);

  const coreError = validateCoreRequiredFields(fields);
  if (coreError) return { error: coreError };

  const newJobError = validateNewJobRequiredFields(fields);
  if (newJobError) return { error: newJobError };

  const duplicateJobNumberError = await validateUniqueJobNumber(supabase, fields.job_number);
  if (duplicateJobNumberError) return { error: duplicateJobNumberError };

  const timeDispatchedError = validateTimeDispatchedRequired(fields.job_status, fields.time_dispatched);
  if (timeDispatchedError) return { error: timeDispatchedError };

  const substatusError = validatePendingCompletionSubstatus(
    fields.job_status,
    fields.pending_completion_substatus
  );
  if (substatusError) return { error: substatusError };

  const permissionError = await requireLeadPermission(fields.agent);
  if (permissionError) return { error: permissionError };

  const reportDate = fields.time_dispatched ? dateInPHT(fields.time_dispatched) : dateInPHT(new Date().toISOString());
  const resolvedReport = await upsertReportForDate(supabase, user.id, reportDate);
  if ("error" in resolvedReport) return { error: resolvedReport.error };
  const targetReportId = resolvedReport.id;

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", targetReportId);

  // lead_id is set directly here (not via findOrCreateLeadForJob) since this
  // job is explicitly being converted from a specific, already-known lead —
  // no matching needed, and it can't create a duplicate.
  const { data: inserted, error } = await supabase
    .from("jobs")
    .insert({
      ...fields,
      report_id: targetReportId,
      row_number: (count ?? 0) + 1,
      source: "manual",
      created_by: user.id,
      lead_id: leadId,
      pending_completion_at: isPendingCompletionStatus(fields.job_status) ? new Date().toISOString() : null,
      completed_at: isCompletedJobStatus(fields.job_status) ? new Date().toISOString() : null,
      cancelled_at: isCancelledJobStatus(fields.job_status) ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error || !inserted) return { error: error?.message ?? "Failed to create the job." };

  const { error: leadUpdateError } = await supabase
    .from("leads")
    .update({
      status: "converted",
      job_id: inserted.id,
      converted_at: new Date().toISOString(),
      quote_status: "accepted",
    })
    .eq("id", leadId);
  if (leadUpdateError) return { error: leadUpdateError.message };

  revalidateLeads(leadId);
  revalidatePath(`/reports/${targetReportId}`);
  revalidatePath("/");

  return { success: true, reportId: targetReportId, jobId: inserted.id };
}

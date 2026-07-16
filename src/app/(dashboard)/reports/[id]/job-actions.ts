"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/aggregate";
import { getCurrentProfile, isSupervisor, requireSupervisor } from "@/lib/profile";
import { PENDING_COMPLETION_SUBSTATUSES } from "@/lib/constants";

function numberOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// datetime-local inputs (e.g. "2026-07-16T14:30") have no timezone; the team
// works in Philippine Time, so treat the entered value as PHT and convert to
// a true UTC instant for storage.
function datetimeLocalPHTToIso(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  return new Date(`${s}:00+08:00`).toISOString();
}

function isDispatchedStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "dispatched";
}

// The ETA countdown always runs off time_dispatched now (no more separate
// automatic timestamp), so saving a job as Dispatched requires it — either
// entered at creation already, or entered right now.
function validateTimeDispatchedRequired(
  jobStatus: string | null,
  timeDispatched: string | null
): string | null {
  if (!isDispatchedStatus(jobStatus)) return null;
  if (!timeDispatched) return "Enter the time dispatched.";
  return null;
}

function isPendingCompletionStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "service rendered – pending completion";
}

function isCompletedJobStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "completed";
}

function isCancelledJobStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "cancelled";
}

function validatePendingCompletionSubstatus(
  jobStatus: string | null,
  substatus: string | null
): string | null {
  if (!isPendingCompletionStatus(jobStatus)) return null;
  if (!substatus) {
    return "Select a sub-status for Service Rendered – Pending Completion.";
  }
  if (!PENDING_COMPLETION_SUBSTATUSES.includes(substatus)) {
    return "Select a valid sub-status.";
  }
  return null;
}

// Required on every save. Both fields are, and always have been, filled in
// on essentially every real job, so enforcing this on edits too is safe.
function validateCoreRequiredFields(fields: {
  job_number: string | null;
  job_amount: number | null;
}): string | null {
  if (!fields.job_number) return "Enter a job number.";
  if (fields.job_amount === null) return "Enter the job amount.";
  return null;
}

// Required only when creating a new job — these fields didn't exist before,
// so most historical jobs don't have them, and requiring them on every edit
// would block editing anything created before this feature shipped.
function validateNewJobRequiredFields(fields: {
  customer_name: string | null;
  time_converted: string | null;
}): string | null {
  if (!fields.customer_name) return "Enter the customer name.";
  if (!fields.time_converted) return "Enter the time converted.";
  return null;
}

type ActionResult = { success: true; id?: string } | { error: string };

export async function getOrCreateTodaysReport(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("reports")
    .upsert({ report_date: todayISO(), uploaded_by: user.id }, { onConflict: "report_date" })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create today's report." };
  revalidatePath("/");
  return { success: true, id: data.id };
}

function jobFieldsFromForm(formData: FormData) {
  const job_amount = numberOrNull(formData.get("job_amount"));
  const vendors_fee = numberOrNull(formData.get("vendors_fee"));
  const refunded_to_client = numberOrNull(formData.get("refunded_to_client"));
  const profit = (job_amount ?? 0) - (vendors_fee ?? 0) - (refunded_to_client ?? 0);

  return {
    agent: strOrNull(formData.get("agent")),
    dispatcher: strOrNull(formData.get("dispatcher")),
    job_number: strOrNull(formData.get("job_number")),
    job_amount,
    vendors_fee,
    refunded_to_client,
    profit,
    vendor_name: strOrNull(formData.get("vendor_name")),
    job_status: strOrNull(formData.get("job_status")),
    eta_minutes: numberOrNull(formData.get("eta_minutes")),
    time_converted: datetimeLocalPHTToIso(formData.get("time_converted")),
    time_dispatched: datetimeLocalPHTToIso(formData.get("time_dispatched")),
    state: strOrNull(formData.get("state")),
    customer_name: strOrNull(formData.get("customer_name")),
    customer_phone: strOrNull(formData.get("customer_phone")),
    customer_charged_via: strOrNull(formData.get("customer_charged_via")),
    vendor_paid_via: strOrNull(formData.get("vendor_paid_via")),
    notes: strOrNull(formData.get("notes")),
    last4_vpc: strOrNull(formData.get("last4_vpc")),
    reviewed_by: strOrNull(formData.get("reviewed_by")),
    call_que: strOrNull(formData.get("call_que")),
    wc_entered_by_jon: strOrNull(formData.get("wc_entered_by_jon")),
    final_checked_by_zumi: strOrNull(formData.get("final_checked_by_zumi")),
    pending_completion_substatus: strOrNull(formData.get("pending_completion_substatus")),
  };
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

  const profile = await getCurrentProfile();
  if (!isSupervisor(profile?.role)) {
    if (!profile?.agent_name) {
      return { error: "Your account isn't linked to an agent name — ask an admin to fix your profile." };
    }
    if (fields.agent !== profile.agent_name) {
      return { error: "You can only create jobs under your own name." };
    }
  }

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", reportId);

  const { error } = await supabase.from("jobs").insert({
    ...fields,
    report_id: reportId,
    row_number: (count ?? 0) + 1,
    source: "manual",
    created_by: user.id,
    pending_completion_at: isPendingCompletionStatus(fields.job_status)
      ? new Date().toISOString()
      : null,
    completed_at: isCompletedJobStatus(fields.job_status) ? new Date().toISOString() : null,
    cancelled_at: isCancelledJobStatus(fields.job_status) ? new Date().toISOString() : null,
  });

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

type JobContext =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      reportId: string;
      currentAgent: string | null;
      currentStatus: string | null;
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
    .select("report_id, agent, job_status, pending_completion_at, completed_at, cancelled_at")
    .eq("id", jobId)
    .single();

  if (error || !existing) return { ok: false, error: "Job not found." };

  return {
    ok: true,
    supabase,
    reportId: existing.report_id as string,
    currentAgent: existing.agent,
    currentStatus: existing.job_status,
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
    currentPendingCompletionAt,
    currentCompletedAt,
    currentCancelledAt,
  } = check;

  const fields = jobFieldsFromForm(formData);

  const coreError = validateCoreRequiredFields(fields);
  if (coreError) return { error: coreError };

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

  const { error } = await supabase
    .from("jobs")
    .update({ ...fields, pending_completion_at, completed_at, cancelled_at })
    .eq("id", jobId);

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
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

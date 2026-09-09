import { createClient } from "@/lib/supabase/server";
import { PENDING_COMPLETION_SUBSTATUSES } from "@/lib/constants";

export function numberOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// datetime-local inputs (e.g. "2026-07-16T14:30") have no timezone; the team
// works in Philippine Time, so treat the entered value as PHT and convert to
// a true UTC instant for storage.
export function datetimeLocalPHTToIso(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  return new Date(`${s}:00+08:00`).toISOString();
}

export function isDispatchedStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "dispatched";
}

export function isPendingCompletionStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "service rendered – pending completion";
}

export function isCompletedJobStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "completed";
}

export function isCancelledJobStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "cancelled";
}

export function isAppointmentStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "appointment";
}

export function isConvertedStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "converted";
}

// The ETA countdown always runs off time_dispatched now (no more separate
// automatic timestamp), so saving a job as Dispatched requires it — either
// entered at creation already, or entered right now.
export function validateTimeDispatchedRequired(
  jobStatus: string | null,
  timeDispatched: string | null
): string | null {
  if (!isDispatchedStatus(jobStatus)) return null;
  if (!timeDispatched) return "Enter the time dispatched.";
  return null;
}

// Dispatching an appointment or converted job means the ETA now measures
// something different (time to arrival, not time to the appointment/
// conversion), so it must be actively reconsidered at this transition, not
// just carried over from before.
export function validateEtaUpdatedOnDispatch(
  currentStatus: string | null,
  newStatus: string | null,
  currentEtaMinutes: number | null,
  newEtaMinutes: number | null
): string | null {
  const wasAppointmentOrConverted =
    isAppointmentStatus(currentStatus) || isConvertedStatus(currentStatus);
  if (!wasAppointmentOrConverted || !isDispatchedStatus(newStatus)) return null;
  if (newEtaMinutes === null) return "Enter the ETA before dispatching this job.";
  if (newEtaMinutes === currentEtaMinutes) return "Update the ETA before dispatching this job.";
  return null;
}

export function validatePendingCompletionSubstatus(
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
export function validateCoreRequiredFields(fields: {
  job_number: string | null;
  job_amount: number | null;
}): string | null {
  if (!fields.job_number) return "Enter a job number.";
  if (fields.job_amount === null) return "Enter the job amount.";
  return null;
}

// Job numbers must be unique across the whole system, not just within a
// report — checked here (defense-in-depth alongside any future insertion
// path, e.g. a bulk import, which should run this same check).
export async function validateUniqueJobNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobNumber: string | null,
  excludeJobId?: string
): Promise<string | null> {
  if (!jobNumber) return null;

  let query = supabase.from("jobs").select("id", { count: "exact", head: true }).eq("job_number", jobNumber);
  if (excludeJobId) query = query.neq("id", excludeJobId);

  const { count } = await query;
  if (count && count > 0) {
    return "This Job ID already exists. Duplicate Job IDs are not allowed.";
  }
  return null;
}

// Required only when creating a new job — these fields didn't exist before,
// so most historical jobs don't have them, and requiring them on every edit
// would block editing anything created before this feature shipped.
export function validateNewJobRequiredFields(fields: {
  customer_name: string | null;
  time_converted: string | null;
}): string | null {
  if (!fields.customer_name) return "Enter the customer name.";
  if (!fields.time_converted) return "Enter the time converted.";
  return null;
}

export type JobFields = ReturnType<typeof jobFieldsFromForm>;

export async function upsertReportForDate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  reportDate: string
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("reports")
    .upsert({ report_date: reportDate, uploaded_by: userId }, { onConflict: "report_date" })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to resolve the report for that date." };
  return { id: data.id };
}

export function jobFieldsFromForm(formData: FormData) {
  const job_amount = numberOrNull(formData.get("job_amount"));
  const vendors_fee = numberOrNull(formData.get("vendors_fee"));
  const refunded_to_client = numberOrNull(formData.get("refunded_to_client"));
  const job_status = strOrNull(formData.get("job_status"));

  // Profit isn't meaningful until a vendor fee has actually been entered, and
  // appointments never have a real profit to report. Cancelled jobs DO get a
  // real (possibly negative) profit once a vendor fee is entered — a vendor
  // fee paid out before the cancellation is a genuine loss, not $0.
  const profit =
    vendors_fee === null || isAppointmentStatus(job_status)
      ? null
      : (job_amount ?? 0) - vendors_fee - (refunded_to_client ?? 0);

  return {
    agent: strOrNull(formData.get("agent")),
    dispatcher: strOrNull(formData.get("dispatcher")),
    job_number: strOrNull(formData.get("job_number")),
    job_amount,
    vendors_fee,
    refunded_to_client,
    profit,
    vendor_name: strOrNull(formData.get("vendor_name")),
    job_status,
    eta_minutes: numberOrNull(formData.get("eta_minutes")),
    appointment_at: datetimeLocalPHTToIso(formData.get("appointment_at")),
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

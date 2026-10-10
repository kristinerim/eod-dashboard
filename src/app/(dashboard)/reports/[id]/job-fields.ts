import { createClient } from "@/lib/supabase/server";
import { PENDING_COMPLETION_SUBSTATUSES } from "@/lib/constants";
import { intakeFieldsFromForm } from "@/lib/intake";
import { numberOrNull, strOrNull } from "@/lib/formParse";

export { numberOrNull, strOrNull };

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
    // Every column shared with leads (service type, locations, vehicle,
    // service details, drop-off, customer, quote notes) — see lib/intake.ts.
    ...intakeFieldsFromForm(formData),

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
    customer_charged_via: strOrNull(formData.get("customer_charged_via")),
    vendor_paid_via: strOrNull(formData.get("vendor_paid_via")),
    notes: strOrNull(formData.get("notes")),
    last4_vpc: strOrNull(formData.get("last4_vpc")),
    reviewed_by: strOrNull(formData.get("reviewed_by")),
    call_que: strOrNull(formData.get("call_que")),
    wc_entered_by_jon: strOrNull(formData.get("wc_entered_by_jon")),
    final_checked_by_zumi: strOrNull(formData.get("final_checked_by_zumi")),
    pending_completion_substatus: strOrNull(formData.get("pending_completion_substatus")),

    // Job Details
    job_name: strOrNull(formData.get("job_name")),

    // Dispatch & operations
    payment_authorization_status: strOrNull(formData.get("payment_authorization_status")),
    dispatch_notes: strOrNull(formData.get("dispatch_notes")),
    preferred_vendor: strOrNull(formData.get("preferred_vendor")),

    // Customer payment authorization (shown in the dispatch step, not the intake)
    customer_card_last4: strOrNull(formData.get("customer_card_last4")),
    customer_billing_address: strOrNull(formData.get("customer_billing_address")),

    // Schedule
    schedule_start_at: datetimeLocalPHTToIso(formData.get("schedule_start_at")),
    schedule_end_at: datetimeLocalPHTToIso(formData.get("schedule_end_at")),
    is_all_day: formData.get("is_all_day") === "on",

    // Service Provider Quote
    quoted_service_amount: numberOrNull(formData.get("quoted_service_amount")),
    goa: formData.get("goa") === "on",
    goa_amount: numberOrNull(formData.get("goa_amount")),

    // Additional Quotes / Payment Information — no CVV or full card number is
    // ever parsed here, per the security requirement (see schema.sql).
    tl_quote: numberOrNull(formData.get("tl_quote")),
    tl_eta_minutes: numberOrNull(formData.get("tl_eta_minutes")),
    quoted_by_dispatcher: strOrNull(formData.get("quoted_by_dispatcher")),
    card_expiry: strOrNull(formData.get("card_expiry")),
    billing_address: strOrNull(formData.get("billing_address")),
  };
}

export interface ContactedVendorRow {
  vendor_name: string | null;
  phone_number: string | null;
  eta_given: string | null;
  goa: boolean;
  goa_amount: number | null;
  // Set when the row was added from the nearby-vendor panel (or linked to the
  // Vendors directory). The tier is copied from the directory when saved.
  vendor_id: string | null;
  quote_amount: number | null;
  notes: string | null;
  vendor_tier: string | null;
  // Team leader who approved using a DNC Tier 1 / Tier 2 vendor.
  tl_approved_by: string | null;
  // The one vendor chosen to handle the job.
  is_assigned: boolean;
}

// The Contacted Vendors list is a client-managed repeatable row group (add/
// remove rows), so it's submitted as one JSON blob rather than parallel
// same-name fields — a checkbox (GOA) only appears in FormData when checked,
// which would silently misalign rows if zipped positionally.
export function contactedVendorsFromForm(formData: FormData): ContactedVendorRow[] {
  const raw = formData.get("contacted_vendors_json");
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const rows: ContactedVendorRow[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const vendor_name = typeof row.vendor_name === "string" ? row.vendor_name.trim() || null : null;
    const phone_number = typeof row.phone_number === "string" ? row.phone_number.trim() || null : null;
    const eta_given = typeof row.eta_given === "string" ? row.eta_given.trim() || null : null;
    if (!vendor_name && !phone_number && !eta_given) continue;
    const goa_amount = typeof row.goa_amount === "number" && !Number.isNaN(row.goa_amount) ? row.goa_amount : null;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
    const quote_amount = typeof row.quote_amount === "number" && !Number.isNaN(row.quote_amount) ? row.quote_amount : null;
    const vendor_id = typeof row.vendor_id === "string" && /^[0-9a-f-]{36}$/i.test(row.vendor_id) ? row.vendor_id : null;
    rows.push({
      vendor_name,
      phone_number,
      eta_given,
      goa: row.goa === true,
      goa_amount,
      vendor_id,
      quote_amount,
      notes: str(row.notes),
      vendor_tier: str(row.vendor_tier),
      tl_approved_by: str(row.tl_approved_by),
      is_assigned: row.is_assigned === true,
    });
  }
  return rows;
}

// GOA (Gone on Arrival) always needs a dollar amount to mean anything — a
// vendor showing up and leaving without doing the job is only useful data
// once you know what that cost. Applies everywhere GOA is recorded: the
// job's own Service Provider Quote and each Contacted Vendor row.
export function validateGoaAmount(goa: boolean, goaAmount: number | null): string | null {
  if (goa && goaAmount === null) return "Enter the GOA amount.";
  return null;
}

export function validateContactedVendorsGoaAmounts(rows: ContactedVendorRow[]): string | null {
  for (const row of rows) {
    if (row.goa && row.goa_amount === null) {
      return `Enter the GOA amount for ${row.vendor_name ?? "the contacted vendor"}.`;
    }
  }
  return null;
}

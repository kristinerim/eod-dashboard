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

    // Client Details
    client_company_name: strOrNull(formData.get("client_company_name")),
    client_email: strOrNull(formData.get("client_email")),
    phone_extension: strOrNull(formData.get("phone_extension")),

    // Service Location
    service_street_address: strOrNull(formData.get("service_street_address")),
    service_unit: strOrNull(formData.get("service_unit")),
    service_city: strOrNull(formData.get("service_city")),
    service_zip: strOrNull(formData.get("service_zip")),
    service_country: strOrNull(formData.get("service_country")),
    service_latitude: numberOrNull(formData.get("service_latitude")),
    service_longitude: numberOrNull(formData.get("service_longitude")),

    // Job Details
    job_name: strOrNull(formData.get("job_name")),
    job_type: strOrNull(formData.get("job_type")),

    // Job Details — dynamic, job-type-specific fields (see src/lib/jobTypeFields.ts).
    // Only the fields relevant to the currently-selected job type are mounted
    // in the form, so this naturally never picks up a stale value from a
    // previously-selected job type.
    year_make_model: strOrNull(formData.get("year_make_model")),
    vin_or_lpn: strOrNull(formData.get("vin_or_lpn")),
    color: strOrNull(formData.get("color")),
    issue: strOrNull(formData.get("issue")),
    can_go_to_neutral: strOrNull(formData.get("can_go_to_neutral")),
    tire_condition: strOrNull(formData.get("tire_condition")),
    drivetrain: strOrNull(formData.get("drivetrain")),
    drop_off_location: strOrNull(formData.get("drop_off_location")),
    second_drop_off_location: strOrNull(formData.get("second_drop_off_location")),
    distance_miles: numberOrNull(formData.get("distance_miles")),
    customer_card_last4: strOrNull(formData.get("customer_card_last4")),
    customer_billing_address: strOrNull(formData.get("customer_billing_address")),
    with_good_spare_tire: strOrNull(formData.get("with_good_spare_tire")),
    locking_lug_nut: strOrNull(formData.get("locking_lug_nut")),
    number_of_gallons: numberOrNull(formData.get("number_of_gallons")),
    fuel_type: strOrNull(formData.get("fuel_type")),
    tire_size: strOrNull(formData.get("tire_size")),
    trailer_type: strOrNull(formData.get("trailer_type")),
    loaded_with: strOrNull(formData.get("loaded_with")),
    trailer_weight: strOrNull(formData.get("trailer_weight")),
    trailer_length: strOrNull(formData.get("trailer_length")),
    trailer_width: strOrNull(formData.get("trailer_width")),
    trailer_height: strOrNull(formData.get("trailer_height")),

    // Schedule
    schedule_start_at: datetimeLocalPHTToIso(formData.get("schedule_start_at")),
    schedule_end_at: datetimeLocalPHTToIso(formData.get("schedule_end_at")),
    is_all_day: formData.get("is_all_day") === "on",

    // Service Provider Quote
    quoted_service_amount: numberOrNull(formData.get("quoted_service_amount")),
    goa: formData.get("goa") === "on",

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
    rows.push({ vendor_name, phone_number, eta_given, goa: row.goa === true });
  }
  return rows;
}

import type { SupabaseClient } from "@supabase/supabase-js";

// Invariant: every job, however it's created, must end up with a lead_id.
// Today that means every place that inserts a row into `jobs` either passes
// a known lead_id directly (convertLeadToJob, converting a specific lead) or
// calls findOrCreateLeadForJob below (createJob, and the one-time backfill
// in scripts/backfill-job-leads.ts). Any future job-creation path — a bulk
// import, an admin tool, anything — must do the same.

// Placeholder values seen in real customer_name data that must never be
// treated as a real name to match on (confirmed via a production dry run —
// "-" alone would otherwise merge several unrelated customers into one lead).
const NAME_DENYLIST = new Set(["-", "n/a", "na", "none", "unknown", "test"]);

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

export function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed === "" || NAME_DENYLIST.has(trimmed) ? null : trimmed;
}

export interface JobCustomerInfo {
  customerName: string | null;
  customerPhone: string | null;
  email: string | null;
  agent: string | null;
  dispatcher: string | null;
  state: string | null;
  jobId: string;
  jobTimeConverted: string | null;
}

// The single place customer-matching logic lives, shared by the one-time
// backfill script and live job creation. Priority: phone, then email, then
// name — matches an existing lead if any tier hits, otherwise creates one.
// Never overwrites an existing lead's fields — only a brand-new lead gets
// populated from the job, since a human may have already edited a matched
// lead since it was created.
export async function findOrCreateLeadForJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  info: JobCustomerInfo
): Promise<{ leadId: string; created: boolean } | { error: string }> {
  const phoneNormalized = normalizePhone(info.customerPhone);
  const emailNormalized = normalizeEmail(info.email);
  const nameNormalized = normalizeName(info.customerName);

  for (const [column, value] of [
    ["phone_normalized", phoneNormalized],
    ["email_normalized", emailNormalized],
    ["name_normalized", nameNormalized],
  ] as const) {
    if (!value) continue;
    const { data, error } = await supabase.from("leads").select("id").eq(column, value).limit(1).maybeSingle();
    if (error) return { error: error.message };
    if (data) return { leadId: data.id, created: false };
  }

  if (!phoneNormalized && !emailNormalized && !nameNormalized) {
    return { error: "No usable customer name, phone, or email to match or create a lead." };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("leads")
    .insert({
      status: "converted",
      agent: info.agent,
      dispatcher: info.dispatcher,
      customer_name: info.customerName,
      customer_phone: info.customerPhone,
      email: info.email,
      state: info.state,
      source: "Auto-created from job",
      job_id: info.jobId,
      converted_at: info.jobTimeConverted ?? new Date().toISOString(),
      phone_normalized: phoneNormalized,
      email_normalized: emailNormalized,
      name_normalized: nameNormalized,
    })
    .select("id")
    .single();

  if (insertError || !inserted) return { error: insertError?.message ?? "Failed to create a lead." };
  return { leadId: inserted.id, created: true };
}

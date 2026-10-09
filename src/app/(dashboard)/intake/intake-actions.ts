"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/leadMatching";

export interface CustomerMatch {
  leadId: string;
  leadNumber: string;
  customerName: string | null;
  company: string | null;
  phone: string | null;
  extension: string | null;
  email: string | null;
  state: string | null;
  jobCount: number;
}

// Powers the "we already know this caller" prompt on the Customer step — the
// lead record doubles as the customer/client record (every job is linked to
// one), so a phone match here means an existing customer.
export async function findCustomerByPhone(
  phone: string,
  excludeLeadId?: string
): Promise<{ match: CustomerMatch | null } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const normalized = normalizePhone(phone);
  if (!normalized) return { match: null };

  let query = supabase
    .from("leads")
    .select("id, lead_number, customer_name, client_company_name, customer_phone, phone_extension, email, state")
    .eq("phone_normalized", normalized)
    .order("created_at", { ascending: false })
    .limit(1);
  if (excludeLeadId) query = query.neq("id", excludeLeadId);

  const { data, error } = await query.maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { match: null };

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", data.id);

  return {
    match: {
      leadId: data.id,
      leadNumber: data.lead_number,
      customerName: data.customer_name,
      company: data.client_company_name,
      phone: data.customer_phone,
      extension: data.phone_extension,
      email: data.email,
      state: data.state,
      jobCount: count ?? 0,
    },
  };
}

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, normalizePhone } from "@/lib/leadMatching";
import { isValidEmail } from "@/lib/contact";

// A customer is identified by phone number (10+ digits), or by email when there
// is no usable phone. Name alone is never used to match — two different people
// can share a name. Customers are created and updated only here, by the server.

type CustomerInfo = {
  name?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
};

export async function ensureCustomer(info: CustomerInfo): Promise<string | null> {
  const phoneNorm = (() => {
    const n = normalizePhone(info.phone);
    return n && n.length >= 10 ? n : null;
  })();
  const emailNorm = isValidEmail(info.email) ? normalizeEmail(info.email) : null;
  if (!phoneNorm && !emailNorm) return null;

  const admin = createAdminClient();

  async function fillBlanks(id: string, existing: { name: string | null; email: string | null; email_normalized: string | null }) {
    const patch: Record<string, string> = {};
    if (!existing.name && info.name?.trim()) patch.name = info.name.trim();
    if (!existing.email && emailNorm) {
      patch.email = info.email!.trim();
      patch.email_normalized = emailNorm;
    }
    if (Object.keys(patch).length > 0) await admin.from("customers").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  }

  if (phoneNorm) {
    const { data } = await admin.from("customers").select("id, name, email, email_normalized").eq("phone_normalized", phoneNorm).maybeSingle();
    if (data) {
      await fillBlanks(data.id, data);
      return data.id;
    }
  }

  if (emailNorm) {
    const { data } = await admin
      .from("customers")
      .select("id, name, email, email_normalized, phone_normalized")
      .eq("email_normalized", emailNorm)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (data) {
      await fillBlanks(data.id, data);
      // The email's owner had no phone on file: this is their number.
      if (phoneNorm && !data.phone_normalized) {
        await admin.from("customers").update({ phone: info.phone!.trim(), phone_normalized: phoneNorm }).eq("id", data.id);
      }
      return data.id;
    }
  }

  const { data: created, error } = await admin
    .from("customers")
    .insert({
      name: info.name?.trim() || null,
      company: info.company?.trim() || null,
      phone: phoneNorm ? info.phone!.trim() : null,
      phone_normalized: phoneNorm,
      email: emailNorm ? info.email!.trim() : null,
      email_normalized: emailNorm,
    })
    .select("id")
    .single();
  if (created) return created.id;

  // Two requests created the same phone at once: use the one that won.
  if (error && phoneNorm) {
    const { data } = await admin.from("customers").select("id").eq("phone_normalized", phoneNorm).maybeSingle();
    return data?.id ?? null;
  }
  return null;
}

// Points a lead at its customer, creating the customer if this is the first
// time they've been seen. Safe to call after every save.
export async function linkLeadToCustomer(leadId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id, customer_id, customer_name, client_company_name, customer_phone, email")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return null;

  const customerId = await ensureCustomer({
    name: lead.customer_name,
    company: lead.client_company_name,
    phone: lead.customer_phone,
    email: lead.email,
  });
  if (customerId && customerId !== lead.customer_id) {
    await admin.from("leads").update({ customer_id: customerId }).eq("id", leadId);
  }
  return customerId ?? lead.customer_id ?? null;
}

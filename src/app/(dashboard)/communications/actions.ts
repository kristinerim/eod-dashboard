"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/profile";
import { containsCardNumber, emailFooter } from "@/lib/communications";
import { isValidEmail } from "@/lib/contact";
import { emailConfig, sendEmail } from "@/lib/email/send";
import type { MessageContext } from "@/components/communications/types";

export type SendEmailInput = {
  // Where the message is being written from. The server works out the rest of
  // the links (a job's lead and customer, a lead's customer) from the database.
  context: MessageContext;
  partyType: "customer" | "vendor";
  partyName: string;
  to: string;
  subject: string;
  body: string;
  templateId?: string | null;
  // Created once when the message is started. Sending the same key twice — a
  // double click, a retry, two windows — can only ever send one email.
  idempotencyKey: string;
};

export type SendEmailResult =
  | { success: true; id: string; status: string; duplicate?: boolean }
  | { error: string };

type Links = {
  jobId: string | null;
  leadId: string | null;
  customerId: string | null;
  vendorId: string | null;
  handledBy: string | null;
};

// Turns "written from this screen" into the full set of links, reading with the
// signed-in user's own access first so nobody can attach a message to a job,
// lead or customer they aren't allowed to see.
async function resolveLinks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: MessageContext,
  partyType: "customer" | "vendor"
): Promise<{ error: string } | Links> {
  const admin = createAdminClient();
  let jobId: string | null = null;
  let leadId: string | null = null;
  let customerId: string | null = null;
  let handledBy: string | null = null;

  if (ctx.jobId) {
    const { data: job } = await supabase.from("jobs").select("id, lead_id, agent").eq("id", ctx.jobId).maybeSingle();
    if (!job) return { error: "You don't have access to this job." };
    jobId = job.id;
    leadId = job.lead_id;
    handledBy = job.agent;
  } else if (ctx.leadId) {
    const { data: lead } = await supabase.from("leads").select("id, agent, customer_id").eq("id", ctx.leadId).maybeSingle();
    if (!lead) return { error: "You don't have access to this lead." };
    leadId = lead.id;
    customerId = lead.customer_id;
    handledBy = lead.agent;
  } else if (ctx.customerId) {
    const { data: customer } = await supabase.from("customers").select("id").eq("id", ctx.customerId).maybeSingle();
    if (!customer) return { error: "You don't have access to this customer." };
    customerId = customer.id;
  }

  // A job's customer is its lead's customer (read after access to the job was proven).
  if (jobId && leadId && !customerId) {
    const { data: lead } = await admin.from("leads").select("customer_id").eq("id", leadId).maybeSingle();
    customerId = lead?.customer_id ?? null;
  }

  let vendorId: string | null = null;
  if (partyType === "vendor") {
    if (ctx.vendorId) {
      const { data: vendor } = await supabase.from("vendors").select("id").eq("id", ctx.vendorId).maybeSingle();
      if (!vendor) return { error: "That vendor no longer exists." };
      vendorId = vendor.id;
    }
    // A vendor message is not part of the customer's own correspondence.
    customerId = null;
  }

  if (!jobId && !leadId && !customerId && !vendorId) return { error: "This message isn't connected to anything." };
  return { jobId, leadId, customerId, vendorId, handledBy };
}

export async function sendEmailMessage(input: SendEmailInput): Promise<SendEmailResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // ---- Check what was submitted ----
  const to = (input.to ?? "").trim();
  const subject = (input.subject ?? "").replace(/\s+/g, " ").trim();
  const body = (input.body ?? "").replace(/\r\n/g, "\n").trim();
  const key = (input.idempotencyKey ?? "").trim();
  if (!isValidEmail(to)) return { error: "Enter a valid email address." };
  if (!subject) return { error: "Enter a subject." };
  if (subject.length > 200) return { error: "The subject is too long (200 characters at most)." };
  if (!body) return { error: "Write a message first." };
  if (body.length > 10000) return { error: "The message is too long." };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) return { error: "Something went wrong. Reload the page and try again." };
  if (input.partyType !== "customer" && input.partyType !== "vendor") return { error: "Choose customer or vendor." };
  if (containsCardNumber(`${subject}\n${body}`)) {
    return { error: "This message looks like it contains a card number. Card numbers must never be sent by email — remove it." };
  }
  if (!emailConfig()) return { error: "Email isn't connected yet, so nothing can be sent." };

  const links = await resolveLinks(supabase, input.context ?? {}, input.partyType);
  if ("error" in links) return links;

  const admin = createAdminClient();

  // ---- Never contact an address that bounced, complained or asked to stop ----
  const { data: blocked } = await admin
    .from("contact_suppressions")
    .select("reason")
    .eq("channel", "email")
    .ilike("address", to)
    .maybeSingle();
  if (blocked) return { error: `This address can't be emailed (${blocked.reason}).` };

  const profile = await getCurrentProfile();
  const senderName = profile?.agent_name || user.email || "Quick Towing";
  const fullBody = `${body}${emailFooter()}`;

  // ---- Record the message first. The unique key means a repeat can't make a second one ----
  const { data: created, error: insertError } = await supabase
    .from("communications")
    .insert({
      job_id: links.jobId,
      lead_id: links.leadId,
      customer_id: links.customerId,
      vendor_id: links.vendorId,
      handled_by_name: links.handledBy,
      channel: "email",
      direction: "outbound",
      party_type: input.partyType,
      party_name: (input.partyName ?? "").trim().slice(0, 200) || null,
      to_address: to,
      subject,
      body: fullBody,
      status: "queued",
      sent_by: user.id,
      sent_by_name: senderName,
      template_id: input.templateId || null,
      idempotency_key: key,
    })
    .select("id, reply_token")
    .single();

  if (insertError || !created) {
    if (insertError?.code === "23505") {
      // Already submitted with this key: report what happened to it, send nothing.
      const { data: existing } = await admin
        .from("communications")
        .select("id, status")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (existing) return { success: true, id: existing.id, status: existing.status, duplicate: true };
    }
    return { error: insertError?.message ?? "Couldn't record the message." };
  }

  // ---- Send it. A reply to this address is filed exactly where this message went ----
  const config = emailConfig();
  const replyTo = config?.replyDomain ? `reply+${created.reply_token}@${config.replyDomain}` : undefined;
  const result = await sendEmail({ to, subject, text: fullBody, replyTo, communicationId: created.id });

  if (!result.ok) {
    await admin
      .from("communications")
      .update({ status: "failed", status_detail: result.error, from_address: result.from || null })
      .eq("id", created.id);
    return { error: result.error };
  }

  await admin
    .from("communications")
    .update({
      status: "sent",
      provider: result.provider,
      provider_message_id: result.messageId,
      from_address: result.from,
      sent_at: new Date().toISOString(),
    })
    .eq("id", created.id);

  return { success: true, id: created.id, status: "sent" };
}

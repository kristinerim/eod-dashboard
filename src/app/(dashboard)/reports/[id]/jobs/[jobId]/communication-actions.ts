"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/profile";
import { containsCardNumber, emailFooter } from "@/lib/communications";
import { isValidEmail } from "@/lib/contact";
import { emailConfig, sendEmail } from "@/lib/email/send";

export type SendJobEmailInput = {
  jobId: string;
  partyType: "customer" | "vendor";
  partyName: string;
  to: string;
  subject: string;
  body: string;
  templateId?: string | null;
  // Created once when the message is started. Sending the same key twice —
  // a double click, a retry, two windows — can only ever send one email.
  idempotencyKey: string;
};

export type SendJobEmailResult =
  | { success: true; id: string; status: string; duplicate?: boolean }
  | { error: string };

export async function sendJobEmail(input: SendJobEmailInput): Promise<SendJobEmailResult> {
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
  if (!emailConfig()) return { error: "Email isn't connected yet. An admin needs to finish the email setup." };

  // ---- Only people who can work on this job may email about it ----
  const { data: job } = await supabase.from("jobs").select("id").eq("id", input.jobId).maybeSingle();
  if (!job) return { error: "You don't have access to this job." };

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
      job_id: input.jobId,
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
    .select("id")
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

  // ---- Send it ----
  const config = emailConfig();
  const replyTo = config?.replyDomain ? `reply+${input.jobId}@${config.replyDomain}` : undefined;
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

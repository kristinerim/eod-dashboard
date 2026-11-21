import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Postmark calls this address with (a) delivery results for emails we sent and
// (b) replies that people send back. It is public, so it is protected by a
// secret in the address (EMAIL_WEBHOOK_SECRET); anything without it is refused.

function authorized(request: Request): boolean {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = new URL(request.url).searchParams.get("token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPRESS_BOUNCES = new Set(["HardBounce", "BadEmailAddress", "SpamNotification", "ManuallyDeactivated", "Unsubscribe"]);

type Payload = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const recordType = str(payload.RecordType);

  // ---- Delivery results for something we sent ----
  if (recordType === "Delivery" || recordType === "Bounce" || recordType === "SpamComplaint") {
    const messageId = str(payload.MessageID);
    if (!messageId) return NextResponse.json({ ok: true });

    if (recordType === "Delivery") {
      await admin
        .from("communications")
        .update({ status: "delivered", delivered_at: str(payload.DeliveredAt) || new Date().toISOString() })
        .eq("provider", "postmark")
        .eq("provider_message_id", messageId)
        .in("status", ["queued", "sent"]);
    } else {
      const bounceType = str(payload.Type);
      const email = str(payload.Email) || str(payload.Recipient);
      const detail = str(payload.Description) || str(payload.Details) || (recordType === "SpamComplaint" ? "Reported as spam" : "Bounced");
      await admin
        .from("communications")
        .update({ status: recordType === "SpamComplaint" ? "complained" : "bounced", status_detail: detail })
        .eq("provider", "postmark")
        .eq("provider_message_id", messageId);
      // A permanent failure or spam report: never email that address again.
      if (email && (recordType === "SpamComplaint" || SUPPRESS_BOUNCES.has(bounceType))) {
        await admin
          .from("contact_suppressions")
          // A repeat is rejected by the unique index, which is exactly what we want.
          .insert({ channel: "email", address: email.toLowerCase(), reason: recordType === "SpamComplaint" ? "reported as spam" : "bounced" });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ---- A reply (inbound email) ----
  const messageId = str(payload.MessageID);
  const jobId = str(payload.MailboxHash);
  const fromFull = (payload.FromFull ?? {}) as { Email?: string; Name?: string };
  const fromEmail = (fromFull.Email || str(payload.From)).toLowerCase();
  if (!messageId || !fromEmail || !UUID.test(jobId)) return NextResponse.json({ ok: true });

  const { data: job } = await admin.from("jobs").select("id, client_email, customer_name").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ ok: true });

  // Who is writing: the customer, one of the job's vendors, or someone else.
  let partyType: "customer" | "vendor" | "other" = "other";
  let partyName: string | null = fromFull.Name || null;
  if ((job.client_email ?? "").toLowerCase() === fromEmail) {
    partyType = "customer";
    partyName = job.customer_name ?? partyName;
  } else {
    const { data: contacted } = await admin
      .from("job_contacted_vendors")
      .select("vendor_name, vendor_id")
      .eq("job_id", jobId);
    const ids = (contacted ?? []).map((c) => c.vendor_id).filter((v): v is string => !!v);
    if (ids.length > 0) {
      const { data: vendors } = await admin.from("vendors").select("id, name, email, secondary_email").in("id", ids);
      const match = (vendors ?? []).find(
        (v) => (v.email ?? "").toLowerCase() === fromEmail || (v.secondary_email ?? "").toLowerCase() === fromEmail
      );
      if (match) {
        partyType = "vendor";
        partyName = match.name;
      }
    }
  }

  const text = (str(payload.StrippedTextReply) || str(payload.TextBody) || str(payload.HtmlBody).replace(/<[^>]+>/g, " ")).trim();
  const subject = str(payload.Subject).slice(0, 300);

  // "STOP" (or similar) as the whole reply: stop emailing that address.
  if (/^\s*(stop|unsubscribe|remove me)\s*[.!]?\s*$/i.test(text.split("\n")[0] ?? "")) {
    await admin
      .from("contact_suppressions")
      .insert({ channel: "email", address: fromEmail, reason: "asked to stop" });
  }

  // Postmark retries until it gets a 200; the unique message id makes that harmless.
  await admin.from("communications").insert({
    job_id: jobId,
    channel: "email",
    direction: "inbound",
    party_type: partyType,
    party_name: partyName,
    from_address: fromEmail,
    to_address: str(payload.OriginalRecipient) || null,
    subject: subject || null,
    body: text.slice(0, 20000) || "(no text)",
    status: "received",
    provider: "postmark",
    provider_message_id: messageId,
  });

  return NextResponse.json({ ok: true });
}

import { plainTextToHtml } from "@/lib/communications";

// Where outgoing email goes. Postmark is the first provider; the rest of the
// app only ever calls sendEmail(), so adding a backup provider later (for
// example Amazon SES) means adding one more branch here, nothing else.
//
// Settings (set in Vercel / .env.local):
//   EMAIL_PROVIDER         postmark | log   (log = test mode: nothing is sent; development only)
//   POSTMARK_SERVER_TOKEN  the Postmark server token
//   EMAIL_FROM             e.g.  Quick Towing <dispatch@yourdomain.com>  (a verified sender)
//   EMAIL_REPLY_DOMAIN     the domain replies are routed through, e.g. reply.yourdomain.com
//   EMAIL_WEBHOOK_SECRET   a long random string that protects the webhook address

export type EmailProviderName = "postmark" | "log";

export function emailConfig(): { provider: EmailProviderName; from: string; replyDomain: string | null } | null {
  const provider = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) return null;
  if (provider === "postmark" && process.env.POSTMARK_SERVER_TOKEN) {
    return { provider: "postmark", from, replyDomain: process.env.EMAIL_REPLY_DOMAIN?.trim() || null };
  }
  // Test mode never reaches a real customer, so it is refused in production.
  if (provider === "log" && process.env.NODE_ENV !== "production") {
    return { provider: "log", from, replyDomain: process.env.EMAIL_REPLY_DOMAIN?.trim() || null };
  }
  return null;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  // Comes back on delivery notifications so a status can be matched to its message.
  communicationId: string;
};

export type SendEmailResult =
  | { ok: true; provider: EmailProviderName; messageId: string; from: string }
  | { ok: false; error: string; from: string };

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const config = emailConfig();
  if (!config) return { ok: false, error: "Email isn't set up yet.", from: "" };

  if (config.provider === "log") {
    console.log(`[email:test-mode] to=${input.to} subject=${JSON.stringify(input.subject)}`);
    return { ok: true, provider: "log", messageId: `log-${input.communicationId}`, from: config.from };
  }

  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN!,
      },
      body: JSON.stringify({
        From: config.from,
        To: input.to,
        Subject: input.subject,
        TextBody: input.text,
        HtmlBody: plainTextToHtml(input.text),
        ReplyTo: input.replyTo,
        MessageStream: "outbound",
        TrackOpens: false,
        Metadata: { communication_id: input.communicationId },
      }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
    if (!res.ok || body.ErrorCode || !body.MessageID) {
      // 406 = Postmark itself is blocking this address (earlier bounce or spam report).
      const reason = body.ErrorCode === 406 ? "This address can't receive email (it bounced or opted out before)." : body.Message;
      return { ok: false, error: reason || `The email service refused the message (${res.status}).`, from: config.from };
    }
    return { ok: true, provider: "postmark", messageId: body.MessageID, from: config.from };
  } catch {
    return { ok: false, error: "Couldn't reach the email service. Try again in a moment.", from: config.from };
  }
}

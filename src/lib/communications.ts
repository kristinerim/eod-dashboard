import { COMPANY_NAME, COMPANY_PHONE } from "@/lib/constants";

export type CommunicationStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "received";

export type PartyType = "customer" | "vendor" | "other";

export const STATUS_STYLES: Record<CommunicationStatus, string> = {
  queued: "bg-black/10 text-black/70",
  sent: "bg-blue-100 text-blue-800",
  delivered: "bg-green-100 text-green-800",
  bounced: "bg-red-100 text-red-800",
  complained: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
  received: "bg-purple-100 text-purple-800",
};

export const STATUS_LABELS: Record<CommunicationStatus, string> = {
  queued: "Sending…",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  received: "Received",
};

// {{merge_fields}} in a template, filled from the job. Anything unknown is left
// blank, never shown as raw {{braces}} to a customer.
export type MergeContext = Record<string, string>;

export function renderTemplate(text: string, ctx: MergeContext): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => ctx[key.toLowerCase()] ?? "");
}

export const COMPANY_MERGE: MergeContext = { company_name: COMPANY_NAME, company_phone: COMPANY_PHONE };

// A 13-19 digit run (spaces or dashes allowed) that passes the Luhn check looks
// like a real card number. Messages containing one are refused, so a card number
// can never be sent by email or text by accident.
export function containsCardNumber(text: string): boolean {
  const candidates = text.match(/(?:\d[ -]?){13,19}/g) ?? [];
  for (const raw of candidates) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = Number(digits[i]);
      if (double) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      double = !double;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Plain text -> a simple, safe HTML email (links made clickable, line breaks kept).
export function plainTextToHtml(text: string): string {
  const withLinks = escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}">${url}</a>`
  );
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;white-space:pre-wrap">${withLinks}</div>`;
}

// Every outgoing email ends with the company's name and number.
export function emailFooter(): string {
  return `\n\n--\n${COMPANY_NAME}\n${COMPANY_PHONE}\nReply to this email to reach our dispatch team.`;
}

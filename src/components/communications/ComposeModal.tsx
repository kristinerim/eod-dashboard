"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMPANY_MERGE, renderTemplate } from "@/lib/communications";
import { isValidEmail, isValidPhone } from "@/lib/contact";
import { formatPhoneDisplay } from "@/lib/vendors";
import { sendEmailMessage } from "@/app/(dashboard)/communications/actions";
import type { InvoiceRef, MessageContext, Recipient, TemplateRow } from "./types";

const inputCls = "w-full rounded border border-black/20 px-2 py-1.5 text-sm";

function newKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2).padEnd(20, "0");
}

// SMS: 160 characters per part (70 if it contains emoji or other special characters).
function smsParts(text: string): { chars: number; parts: number } {
  const unicode = /[^\x00-\x7F]/.test(text);
  const per = unicode ? 70 : 160;
  return { chars: text.length, parts: text.length === 0 ? 0 : Math.ceil(text.length / per) };
}

// The window for writing an SMS or email. It opens on top of the current
// screen, with the saved phone number or email already filled in. When the
// channel isn't connected to a provider it is a PREVIEW: it can be drafted, but
// it cannot be sent, and says so plainly.
export default function ComposeModal({
  channel,
  context,
  recipients,
  templates,
  mergeBase,
  invoices,
  canSend,
  onClose,
}: {
  channel: "email" | "sms";
  context: MessageContext;
  recipients: Recipient[];
  templates: TemplateRow[];
  mergeBase: Record<string, string>;
  invoices: InvoiceRef[];
  canSend: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [recipientIndex, setRecipientIndex] = useState(0);
  const recipient = recipients[recipientIndex];
  const saved = (r: Recipient | undefined) => {
    if (channel === "email") return r?.email ?? "";
    const digits = (r?.phone ?? "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
    return digits.length === 10 ? formatPhoneDisplay(digits) : (r?.phone ?? "");
  };
  const [to, setTo] = useState(saved(recipients[0]));
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef(newKey());

  const goVendor = recipients.find((r) => r.partyType === "vendor" && r.isGo);
  const partyTemplates = templates.filter((t) => t.audience === (recipient?.partyType ?? "customer"));
  const label = channel === "email" ? "email address" : "phone number";

  const merge = useMemo(() => {
    const invoice = invoices[0];
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const isVendor = recipient?.partyType === "vendor";
    const customer = recipients.find((r) => r.partyType === "customer");
    return {
      ...COMPANY_MERGE,
      ...mergeBase,
      customer_name: customer?.name ?? mergeBase.customer_name ?? "",
      vendor_name: isVendor ? (recipient?.name ?? "") : (goVendor?.name ?? ""),
      vendor_quote: isVendor ? (recipient?.quote ?? "") : "",
      eta: (isVendor ? recipient?.eta : goVendor?.eta) || mergeBase.eta || "",
      invoice_link: invoice ? `${origin}/sign/${invoice.token}` : "",
      invoice_number: invoice?.number ?? "",
    } as Record<string, string>;
  }, [invoices, mergeBase, recipients, recipient, goVendor]);

  function pickRecipient(index: number) {
    setRecipientIndex(index);
    setTo(saved(recipients[index]));
    setTemplateId("");
    setError(null);
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(renderTemplate(t.subject ?? "", merge));
    setBody(renderTemplate(t.body, merge));
  }

  const blanks = useMemo(() => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return [] as string[];
    const keys = new Set<string>();
    for (const m of `${t.subject ?? ""} ${t.body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) keys.add(m[1].toLowerCase());
    return Array.from(keys).filter((k) => !merge[k]);
  }, [templateId, templates, merge]);

  function send() {
    setError(null);
    if (channel !== "email") return;
    if (!isValidEmail(to)) return setError("Enter a valid email address.");
    startTransition(async () => {
      const result = await sendEmailMessage({
        // The vendor picked in this window is linked too, so the message also
        // appears on that vendor's profile.
        context: { ...context, vendorId: recipient?.partyType === "vendor" ? (recipient.vendorId ?? context.vendorId) : null },
        partyType: recipient?.partyType ?? "customer",
        partyName: recipient?.name ?? "",
        to,
        subject,
        body,
        templateId: templateId || null,
        idempotencyKey: key.current,
      });
      key.current = newKey(); // whatever happened, the next attempt is a new message
      if ("error" in result) {
        setError(result.error);
        router.refresh();
        return;
      }
      setDone(result.duplicate ? "That message had already been sent." : `Email sent to ${to}.`);
      router.refresh();
    });
  }

  const sms = smsParts(body);
  const validTo = channel === "email" ? isValidEmail(to) : isValidPhone(to);
  const missingSaved = recipient && !saved(recipient);
  const ready = validTo && body.trim() !== "" && (channel === "sms" || subject.trim() !== "");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">{channel === "email" ? "New email" : "New text message"}</h3>
          <button type="button" onClick={onClose} className="text-black/50 hover:text-black" aria-label="Close">
            ✕
          </button>
        </div>

        {!canSend && (
          <div className="rounded border-2 border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-bold">PREVIEW ONLY.</span>{" "}
            {channel === "email" ? "Email" : "Text messaging"} isn&apos;t connected yet, so this message
            <span className="font-semibold"> cannot be sent</span>. You can draft it to see how it will look, but nothing
            leaves the Hub and nothing is saved.
          </div>
        )}

        {done ? (
          <div className="space-y-3">
            <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">{done} ✓</p>
            <button type="button" onClick={onClose} className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white">
              Close
            </button>
          </div>
        ) : (
          <>
            {recipients.length > 1 && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-black/60">Send to</span>
                <select value={recipientIndex} onChange={(e) => pickRecipient(Number(e.target.value))} className={inputCls}>
                  {recipients.map((r, i) => (
                    <option key={r.id} value={i}>
                      {r.label}: {r.name || "(no name)"}
                      {r.isGo ? " (assigned)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block space-y-1">
              <span className="text-xs font-medium text-black/60">
                To {recipient?.name ? `(${recipient.name})` : ""} — {label}
              </span>
              <input
                type={channel === "email" ? "email" : "tel"}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={inputCls}
                placeholder={channel === "email" ? "name@example.com" : "(555) 123-4567"}
              />
              {missingSaved && (
                <span className="block text-xs font-medium text-red-600">
                  No {label} is saved for {recipient?.name || "this contact"}. Add it to their record, or type one in above.
                </span>
              )}
            </label>

            {channel === "email" ? (
              <>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-black/60">Template</span>
                  {templates.length > 0 ? (
                    <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} className={inputCls}>
                      <option value="">Write my own…</option>
                      {partyTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select disabled className={`${inputCls} bg-black/5 text-black/40`}>
                      <option>Templates are available on jobs</option>
                    </select>
                  )}
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-black/60">Subject</span>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={inputCls} />
                </label>
              </>
            ) : (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-black/60">Template</span>
                <select disabled className={`${inputCls} bg-black/5 text-black/40`}>
                  <option>Text templates are coming in a future update</option>
                </select>
              </label>
            )}

            <label className="block space-y-1">
              <span className="text-xs font-medium text-black/60">Message</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "sms" ? 5 : 8} className={inputCls} />
              {channel === "sms" && (
                <span className="block text-xs text-black/50">
                  {sms.chars} characters · {sms.parts} text part{sms.parts === 1 ? "" : "s"}
                </span>
              )}
            </label>

            {channel === "email" && (
              <p className="text-xs text-black/50">
                Attachments and more templates are coming later. Our company name and phone number are added at the bottom
                automatically. Never put a card number in a message.
              </p>
            )}
            {blanks.length > 0 && (
              <p className="text-xs text-amber-700">
                Not filled in yet: {blanks.map((b) => b.replace(/_/g, " ")).join(", ")}. Check the message before sending.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded border border-black/20 px-4 py-1.5 text-sm">
                {canSend ? "Cancel" : "Close"}
              </button>
              {canSend ? (
                <button
                  type="button"
                  onClick={send}
                  disabled={!ready || isPending}
                  className="rounded bg-black px-5 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {isPending ? "Sending..." : "Send email"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Sending isn't connected yet"
                  className="cursor-not-allowed rounded border border-black/20 bg-black/5 px-5 py-1.5 text-sm font-medium text-black/40"
                >
                  Sending unavailable — preview only
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

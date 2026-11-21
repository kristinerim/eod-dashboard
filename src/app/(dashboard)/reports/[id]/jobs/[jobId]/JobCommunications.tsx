"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COMPANY_MERGE, STATUS_LABELS, STATUS_STYLES, renderTemplate, type CommunicationStatus } from "@/lib/communications";
import { isValidEmail } from "@/lib/contact";
import { sendJobEmail } from "./communication-actions";

export type CommunicationRow = {
  id: string;
  channel: "email" | "sms";
  direction: "outbound" | "inbound";
  party_type: "customer" | "vendor" | "other";
  party_name: string | null;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  body: string;
  status: CommunicationStatus;
  status_detail: string | null;
  sent_by_name: string | null;
  created_at: string;
};

export type TemplateRow = {
  id: string;
  audience: "customer" | "vendor";
  name: string;
  subject: string | null;
  body: string;
};

export type VendorContact = {
  name: string;
  email: string | null;
  secondaryEmail: string | null;
  quote: string;
  eta: string;
  isGo: boolean;
};

export type InvoiceRef = { number: string | null; token: string };

const inputCls = "w-full rounded border border-black/20 px-2 py-1.5 text-sm";

function newKey(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "")
    : Math.random().toString(36).slice(2).padEnd(20, "0");
}

function when(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} PHT`;
}

// Everything said to or by the customer and the vendors on this job, in one
// place, plus a box to write the next email. Stays on the job after it is done.
export default function JobCommunications({
  jobId,
  communications,
  templates,
  customer,
  vendors,
  mergeBase,
  invoices,
  emailEnabled,
}: {
  jobId: string;
  communications: CommunicationRow[];
  templates: TemplateRow[];
  customer: { name: string; email: string | null };
  vendors: VendorContact[];
  mergeBase: Record<string, string>;
  invoices: InvoiceRef[];
  emailEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [party, setParty] = useState<"customer" | "vendor">("customer");
  const goVendor = vendors.find((v) => v.isGo);
  const [vendorIndex, setVendorIndex] = useState(() => Math.max(0, vendors.findIndex((v) => v.isGo)));
  const vendor = vendors[vendorIndex];

  const [to, setTo] = useState(customer.email ?? "");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const key = useRef(newKey());

  const partyName = party === "customer" ? customer.name : (vendor?.name ?? "");
  const partyTemplates = templates.filter((t) => t.audience === party);

  // The values a template can use, for whoever is being written to.
  const merge = useMemo(() => {
    const invoice = invoices[0];
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return {
      ...COMPANY_MERGE,
      ...mergeBase,
      customer_name: customer.name,
      vendor_name: party === "vendor" ? (vendor?.name ?? "") : (goVendor?.name ?? ""),
      vendor_quote: party === "vendor" ? (vendor?.quote ?? "") : "",
      eta: (party === "vendor" ? vendor?.eta : goVendor?.eta) || mergeBase.eta || "",
      invoice_link: invoice ? `${origin}/sign/${invoice.token}` : "",
      invoice_number: invoice?.number ?? "",
    };
  }, [invoices, mergeBase, customer.name, party, vendor, goVendor]);

  function pickParty(next: "customer" | "vendor") {
    setParty(next);
    setTemplateId("");
    setError(null);
    setSentNote(null);
    setTo(next === "customer" ? (customer.email ?? "") : (vendors[vendorIndex]?.email ?? vendors[vendorIndex]?.secondaryEmail ?? ""));
  }

  function pickVendor(index: number) {
    setVendorIndex(index);
    setTo(vendors[index]?.email ?? vendors[index]?.secondaryEmail ?? "");
    setTemplateId("");
  }

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(renderTemplate(t.subject ?? "", merge));
    setBody(renderTemplate(t.body, merge));
  }

  // Template details that came out blank (e.g. no invoice yet), so nothing goes
  // out with an empty gap in it unnoticed.
  const blanks = useMemo(() => {
    const t = templates.find((x) => x.id === templateId);
    if (!t) return [] as string[];
    const keys = new Set<string>();
    for (const m of `${t.subject ?? ""} ${t.body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) keys.add(m[1].toLowerCase());
    return Array.from(keys).filter((k) => !(merge as Record<string, string>)[k]);
  }, [templateId, templates, merge]);

  function send() {
    setError(null);
    setSentNote(null);
    if (!isValidEmail(to)) return setError("Enter a valid email address.");
    startTransition(async () => {
      const result = await sendJobEmail({
        jobId,
        partyType: party,
        partyName,
        to,
        subject,
        body,
        templateId: templateId || null,
        idempotencyKey: key.current,
      });
      // Whatever the outcome, the next attempt is a new message.
      key.current = newKey();
      if ("error" in result) {
        setError(result.error);
        router.refresh();
        return;
      }
      setSentNote(result.duplicate ? "That message had already been sent." : `Email sent to ${to}.`);
      setSubject("");
      setBody("");
      setTemplateId("");
      router.refresh();
    });
  }

  const thread = [...communications].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const canSend = emailEnabled && !isPending && subject.trim() !== "" && body.trim() !== "" && to.trim() !== "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Communications</h2>
        <div className="flex gap-1.5">
          {(["email", "sms"] as const).map((c) => (
            <button
              key={c}
              type="button"
              disabled={c === "sms"}
              onClick={() => setChannel(c)}
              title={c === "sms" ? "Text messaging is coming soon" : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                channel === c ? "border-black bg-black text-white" : "border-black/20 text-black/70"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {c === "email" ? "Email" : "SMS (coming soon)"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-black/10">
        {/* History */}
        <div className="max-h-96 space-y-2 overflow-y-auto border-b border-black/10 p-3">
          {thread.length === 0 && (
            <p className="py-4 text-center text-sm text-black/50">
              Nothing sent or received on this job yet. Emails will appear here, with their delivery status.
            </p>
          )}
          {thread.map((c) => {
            const out = c.direction === "outbound";
            return (
              <div key={c.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm ${
                    out ? "border-blue-200 bg-blue-50" : "border-purple-200 bg-purple-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-black/60">
                    <span className="font-semibold text-black/80">
                      {out ? `${c.sent_by_name ?? "Staff"} → ${c.party_name || c.to_address}` : `${c.party_name || c.from_address} → us`}
                    </span>
                    <span className="uppercase">{c.party_type}</span>
                    <span>{when(c.created_at)}</span>
                    <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[c.status]}`}>
                      {STATUS_LABELS[c.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-black/50">
                    {out ? `To: ${c.to_address}` : `From: ${c.from_address}`}
                  </div>
                  {c.subject && <div className="mt-1 font-medium">{c.subject}</div>}
                  <div className="mt-1 whitespace-pre-wrap break-words text-black/80">{c.body}</div>
                  {c.status_detail && (c.status === "failed" || c.status === "bounced" || c.status === "complained") && (
                    <div className="mt-1 text-xs font-medium text-red-700">{c.status_detail}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Composer */}
        <div className="space-y-3 p-3">
          {!emailEnabled && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Email isn&apos;t connected yet, so messages can&apos;t be sent. Past messages will still appear here. An admin
              needs to finish the email setup.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {(["customer", "vendor"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={p === "vendor" && vendors.length === 0}
                  onClick={() => pickParty(p)}
                  title={p === "vendor" && vendors.length === 0 ? "No vendors on this job yet" : undefined}
                  className={`rounded border px-3 py-1 text-xs font-medium ${
                    party === p ? "border-black bg-black text-white" : "border-black/20"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {p === "customer" ? "Customer" : "Vendor"}
                </button>
              ))}
            </div>
            {party === "vendor" && vendors.length > 0 && (
              <select value={vendorIndex} onChange={(e) => pickVendor(Number(e.target.value))} className="rounded border border-black/20 px-2 py-1 text-sm">
                {vendors.map((v, i) => (
                  <option key={`${v.name}-${i}`} value={i}>
                    {v.name}
                    {v.isGo ? " (assigned)" : ""}
                  </option>
                ))}
              </select>
            )}
            <select
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
              className="rounded border border-black/20 px-2 py-1 text-sm"
              aria-label="Template"
            >
              <option value="">Write my own…</option>
              {partyTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-black/60">
              To {partyName ? `(${partyName})` : ""}
              {!to && <span className="text-amber-700"> — no email on file, type one in</span>}
            </span>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} placeholder="name@example.com" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-black/60">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={inputCls} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-black/60">Message</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className={inputCls} />
          </label>

          {blanks.length > 0 && (
            <p className="text-xs text-amber-700">
              Not filled in yet: {blanks.map((b) => b.replace(/_/g, " ")).join(", ")}. Check the message before sending.
            </p>
          )}
          <p className="text-xs text-black/50">
            Our company name and phone number are added at the bottom automatically. Never put a card number in a message.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {sentNote && <p className="text-sm text-green-700">{sentNote} ✓</p>}

          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="rounded bg-black px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {isPending ? "Sending..." : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { STATUS_LABELS, STATUS_STYLES } from "@/lib/communications";
import { formatPhoneDisplay } from "@/lib/vendors";
import ComposeModal from "./ComposeModal";
import type { CommunicationRow, InvoiceRef, MessageContext, Recipient, TemplateRow } from "./types";

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

type Tab = "all" | "sms" | "email";

// The one Communications section used on a Customer, a Lead, a Job and a
// Vendor: the same layout everywhere, showing only the messages that belong to
// that record. Messages are stored once and shown wherever they are linked.
export default function CommunicationPanel({
  context,
  rows,
  recipients,
  emailConnected,
  smsConnected,
  templates = [],
  mergeBase = {},
  invoices = [],
  showLinks = false,
  note,
}: {
  context: MessageContext;
  rows: CommunicationRow[];
  recipients: Recipient[];
  emailConnected: boolean;
  smsConnected: boolean;
  templates?: TemplateRow[];
  mergeBase?: Record<string, string>;
  invoices?: InvoiceRef[];
  // On a customer or vendor, show which lead or job each message belongs to.
  showLinks?: boolean;
  note?: string;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [compose, setCompose] = useState<"email" | "sms" | null>(null);

  const thread = [...rows]
    .filter((r) => tab === "all" || r.channel === tab)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const counts = { all: rows.length, sms: rows.filter((r) => r.channel === "sms").length, email: rows.filter((r) => r.channel === "email").length };
  const first = recipients[0];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Communications</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCompose("sms")}
            className="rounded border border-black/30 px-3 py-1.5 text-sm font-medium hover:bg-black/5"
          >
            Send SMS{!smsConnected && <span className="ml-1 text-[10px] font-normal uppercase text-amber-700">preview</span>}
          </button>
          <button
            type="button"
            onClick={() => setCompose("email")}
            className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white"
          >
            Send Email{!emailConnected && <span className="ml-1 text-[10px] font-normal uppercase text-amber-300">preview</span>}
          </button>
        </div>
      </div>

      {(!emailConnected || !smsConnected) && (
        <p className="text-xs text-amber-800">
          {!emailConnected && !smsConnected
            ? "Email and text sending aren't connected yet — the Send buttons open a preview only. Nothing can be sent."
            : !emailConnected
              ? "Email sending isn't connected yet — Send Email opens a preview only."
              : "Text sending isn't connected yet — Send SMS opens a preview only."}
        </p>
      )}

      {first && (!first.phone || !first.email) && (
        <p className="text-xs font-medium text-red-600">
          {first.name || first.label}: {!first.phone && "no phone number saved"}
          {!first.phone && !first.email && " · "}
          {!first.email && "no email address saved"}.
        </p>
      )}
      {first && (first.phone || first.email) && (
        <p className="text-xs text-black/50">
          {first.label}: {first.name || "—"}
          {first.phone ? ` · ${formatPhoneDisplay(first.phone)}` : ""}
          {first.email ? ` · ${first.email}` : ""}
        </p>
      )}
      {note && <p className="text-xs text-black/50">{note}</p>}

      <div className="rounded-lg border border-black/10">
        <div className="flex gap-1.5 border-b border-black/10 px-3 py-2">
          {(["all", "sms", "email"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                tab === t ? "border-black bg-black text-white" : "border-black/20 text-black/70 hover:bg-black/5"
              }`}
            >
              {t === "all" ? "All" : t === "sms" ? "SMS" : "Email"} ({counts[t]})
            </button>
          ))}
        </div>

        <div className="max-h-[28rem] space-y-2 overflow-y-auto p-3">
          {thread.length === 0 && (
            <p className="py-6 text-center text-sm text-black/50">
              No {tab === "all" ? "" : tab === "sms" ? "text messages " : "emails "}here yet. Messages sent to or received from
              this contact will appear in order, with their delivery status.
            </p>
          )}
          {thread.map((c) => {
            const out = c.direction === "outbound";
            const agent = out ? c.sent_by_name : c.handled_by_name;
            return (
              <div key={c.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[88%] rounded-lg border px-3 py-2 text-sm ${out ? "border-blue-200 bg-blue-50" : "border-purple-200 bg-purple-50"}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-black/60">
                    <span className="rounded bg-black/10 px-1.5 py-0.5 font-semibold uppercase text-black/70">{c.channel}</span>
                    <span className="font-semibold text-black/80">
                      {out ? `${c.sent_by_name ?? "Staff"} → ${c.party_name || c.to_address}` : `${c.party_name || c.from_address} → us`}
                    </span>
                    <span className="uppercase">{c.party_type}</span>
                    <span>{when(c.created_at)}</span>
                    <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[c.status]}`}>{STATUS_LABELS[c.status]}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-black/50">
                    <span>{out ? `To: ${c.to_address}` : `From: ${c.from_address}`}</span>
                    {agent && <span>{out ? "Sent by" : "Handled by"}: {agent}</span>}
                    {showLinks && c.lead && c.lead_id && (
                      <Link href={`/leads/${c.lead_id}`} className="underline">
                        Lead {c.lead.lead_number}
                      </Link>
                    )}
                    {showLinks && c.job_id && (
                      <span>Job {c.job?.job_number ?? ""}</span>
                    )}
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
      </div>

      {compose && (
        <ComposeModal
          channel={compose}
          context={context}
          recipients={recipients}
          templates={compose === "email" ? templates : []}
          mergeBase={mergeBase}
          invoices={invoices}
          canSend={compose === "email" ? emailConnected : smsConnected}
          onClose={() => setCompose(null)}
        />
      )}
    </section>
  );
}

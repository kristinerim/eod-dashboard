"use client";

import { useState } from "react";
import Link from "next/link";
import LeadForm from "./LeadForm";
import { QUOTE_STATUS_LABELS } from "@/lib/constants";

export interface Lead {
  id: string;
  lead_number: string;
  status: "open" | "converted" | "lost";
  agent: string | null;
  dispatcher: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  email: string | null;
  state: string | null;
  source: string | null;
  notes: string | null;
  disposition: string | null;
  disposition_notes: string | null;
  disposition_at: string | null;
  job_id: string | null;
  converted_at: string | null;
  created_at: string;
  job_type: string | null;
  year_make_model: string | null;
  service_city: string | null;
  dropoff_city: string | null;
  quoted_price: number | null;
  additional_charges: number | null;
  quote_status: "quoting" | "quoted" | "accepted" | "declined" | "follow_up";
}

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

function StatusBadge({ status }: { status: Lead["status"] }) {
  const styles: Record<Lead["status"], string> = {
    open: "bg-blue-100 text-blue-700",
    converted: "bg-green-100 text-green-700",
    lost: "bg-black/10 text-black/60",
  };
  const labels: Record<Lead["status"], string> = {
    open: "Open",
    converted: "Converted",
    lost: "Lost",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function LeadsTable({
  leads,
  agentOptions,
  currentRole,
  currentAgentName,
}: {
  leads: Lead[];
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
}) {
  const canEditLead = (lead: Lead) => currentRole !== "agent" || lead.agent === currentAgentName;
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  // Searching, status filtering, and paging happen on the server (see
  // leads/page.tsx) — this table only ever receives the current page.
  const filtered = leads;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Actions</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Lead #</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Agent</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Service</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Quote</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Customer</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Phone</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">State</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Disposition</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/leads/${l.id}`} className="mr-2 text-black/60 hover:text-black hover:underline">
                    View
                  </Link>
                  {l.status === "open" && canEditLead(l) && (
                    <button
                      onClick={() => setEditingLead(l)}
                      className="text-black/60 hover:text-black hover:underline"
                      type="button"
                    >
                      Edit
                    </button>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium">{l.lead_number}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <StatusBadge status={l.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{l.agent ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{l.job_type ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {l.quoted_price != null || l.additional_charges != null
                    ? ((l.quoted_price ?? 0) + (l.additional_charges ?? 0)).toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                      })
                    : "-"}{" "}
                  <span className="text-xs text-black/40">
                    {l.status === "open" && l.quote_status ? QUOTE_STATUS_LABELS[l.quote_status] : ""}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{l.customer_name ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{l.customer_phone ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{l.state ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{l.disposition ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(l.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-black/50">
                  No leads match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingLead && (
        <LeadForm
          lead={editingLead}
          onClose={() => setEditingLead(null)}
          agentOptions={agentOptions}
          currentRole={currentRole}
          currentAgentName={currentAgentName}
        />
      )}
    </div>
  );
}

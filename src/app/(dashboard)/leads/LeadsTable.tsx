"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import LeadForm from "./LeadForm";

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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Lead["status"]>("");
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter && l.status !== statusFilter) return false;
      if (!q) return true;
      return [l.lead_number, l.agent, l.customer_name, l.customer_phone, l.notes].some((f) =>
        String(f ?? "").toLowerCase().includes(q)
      );
    });
  }, [leads, search, statusFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lead #, agent, customer, phone..."
          className="w-64 rounded border border-black/20 px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | Lead["status"])}
          className="rounded border border-black/20 px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="converted">Converted</option>
          <option value="lost">Lost</option>
        </select>
        <span className="self-center text-xs text-black/50">
          {filtered.length} of {leads.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Actions</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Lead #</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Agent</th>
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
                <td className="whitespace-nowrap px-3 py-2">{l.customer_name ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{l.customer_phone ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{l.state ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{l.disposition ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(l.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-black/50">
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

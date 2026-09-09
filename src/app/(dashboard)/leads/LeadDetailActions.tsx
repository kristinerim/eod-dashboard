"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LEAD_DISPOSITIONS } from "@/lib/constants";
import { markLeadLost, reopenLead, deleteLead } from "./lead-actions";
import ConvertToJobForm from "./ConvertToJobForm";
import LeadForm from "./LeadForm";
import type { Lead } from "./LeadsTable";

export default function LeadDetailActions({
  lead,
  canDelete,
  agentOptions,
  currentRole,
  currentAgentName,
}: {
  lead: Lead;
  canDelete: boolean;
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [markingLost, setMarkingLost] = useState(false);
  const [disposition, setDisposition] = useState("");
  const [dispositionNotes, setDispositionNotes] = useState("");
  const canEdit = currentRole !== "agent" || lead.agent === currentAgentName;

  function handleMarkLost(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await markLeadLost(lead.id, formData);
      if ("error" in result) return setError(result.error);
      setMarkingLost(false);
      router.refresh();
    });
  }

  function handleReopen() {
    setError(null);
    startTransition(async () => {
      const result = await reopenLead(lead.id);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this lead? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteLead(lead.id);
      if ("error" in result) return setError(result.error);
      router.push("/leads");
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {lead.status === "open" && canEdit && (
          <>
            <button
              onClick={() => setConverting(true)}
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white"
              type="button"
            >
              Convert to job
            </button>
            <button
              onClick={() => setEditing(true)}
              className="rounded border border-black/20 px-4 py-1.5 text-sm"
              type="button"
            >
              Edit details
            </button>
            <button
              onClick={() => setMarkingLost(true)}
              className="rounded border border-black/20 px-4 py-1.5 text-sm"
              type="button"
            >
              Mark as lost
            </button>
          </>
        )}
        {lead.status === "lost" && canEdit && (
          <button
            onClick={handleReopen}
            disabled={isPending}
            className="rounded border border-black/20 px-4 py-1.5 text-sm disabled:opacity-50"
            type="button"
          >
            Reopen lead
          </button>
        )}
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 disabled:opacity-50"
            type="button"
          >
            Delete
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {markingLost && (
        <form onSubmit={handleMarkLost} className="space-y-2 rounded-lg border border-black/10 p-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-black/60">Reason (required)</span>
            <select
              name="disposition"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              required
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            >
              <option value="" disabled>
                Select a reason
              </option>
              {LEAD_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-black/60">Notes (optional)</span>
            <textarea
              name="disposition_notes"
              value={dispositionNotes}
              onChange={(e) => setDispositionNotes(e.target.value)}
              rows={2}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMarkingLost(false)}
              className="rounded border border-black/20 px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Mark as lost"}
            </button>
          </div>
        </form>
      )}

      {converting && (
        <ConvertToJobForm
          lead={lead}
          onClose={() => setConverting(false)}
          agentOptions={agentOptions}
          currentRole={currentRole}
          currentAgentName={currentAgentName}
        />
      )}

      {editing && (
        <LeadForm
          lead={lead}
          onClose={() => setEditing(false)}
          agentOptions={agentOptions}
          currentRole={currentRole}
          currentAgentName={currentAgentName}
        />
      )}
    </div>
  );
}

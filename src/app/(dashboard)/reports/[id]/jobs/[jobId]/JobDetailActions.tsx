"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import JobForm from "../../JobForm";
import type { Job } from "../../JobsTable";
import { cancelJob, refundJob, deleteJobAnyDay } from "./actions";

export default function JobDetailActions({
  job,
  reportId,
  canDelete,
  agentOptions,
}: {
  job: Job;
  reportId: string;
  canDelete: boolean;
  agentOptions?: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    const reason = prompt("Why is this job being cancelled?", job.cancellation_reason ?? "");
    if (reason === null) return;
    if (!reason.trim()) return setError("Enter a reason for the cancellation.");
    setError(null);
    startTransition(async () => {
      const result = await cancelJob(job.id, reportId, reason);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleRefund() {
    const input = prompt("Refund amount ($):", job.refunded_to_client?.toString() ?? "0");
    if (input === null) return;
    const amount = Number(input);
    if (Number.isNaN(amount) || amount < 0) return setError("Enter a valid refund amount.");
    setError(null);
    startTransition(async () => {
      const result = await refundJob(job.id, reportId, amount);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this job entry? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteJobAnyDay(job.id, reportId);
      if ("error" in result) return setError(result.error);
      router.push(`/reports/${reportId}`);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setEditing(true)}
          className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white"
        >
          Edit details
        </button>
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="rounded border border-black/20 px-4 py-1.5 text-sm disabled:opacity-50"
        >
          Cancel job
        </button>
        <button
          onClick={handleRefund}
          disabled={isPending}
          className="rounded border border-black/20 px-4 py-1.5 text-sm disabled:opacity-50"
        >
          Refund
        </button>
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {editing && (
        <JobForm
          reportId={reportId}
          job={job}
          onClose={() => setEditing(false)}
          agentOptions={agentOptions}
        />
      )}
    </div>
  );
}

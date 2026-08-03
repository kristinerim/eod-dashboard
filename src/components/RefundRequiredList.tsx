"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { refundJob } from "@/app/(dashboard)/reports/[id]/jobs/[jobId]/actions";

export interface RefundRequiredJob {
  id: string;
  report_id: string;
  agent: string | null;
  dispatcher: string | null;
  job_number: string | null;
  vendor_name: string | null;
  state: string | null;
  customer_phone: string | null;
  job_amount: number | null;
  refunded_to_client: number | null;
  cancellation_reason: string | null;
}

function formatCurrency(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function RefundDialog({ job, onClose }: { job: RefundRequiredJob; onClose: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const alreadyRefunded = job.refunded_to_client ?? 0;
  const remaining = (job.job_amount ?? 0) - alreadyRefunded;

  function handleProcessRefund(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = Number(amount);
    if (Number.isNaN(value) || value <= 0) {
      setError("Enter a valid refund amount.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await refundJob(job.id, job.report_id, value);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Refund Required</h2>
          <button onClick={onClose} className="text-black/50 hover:text-black" type="button">
            ✕
          </button>
        </div>

        <div className="mb-4 space-y-1.5 rounded border border-black/10 bg-black/[0.02] p-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Job #</span>
            <span className="font-medium">{job.job_number ?? "-"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Agent</span>
            <span className="font-medium">{job.agent ?? "-"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Vendor</span>
            <span className="font-medium">{job.vendor_name ?? "-"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-black/50">State</span>
            <span className="font-medium">{job.state ?? "-"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Customer phone</span>
            <span className="font-medium">{job.customer_phone ?? "-"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Cancellation reason</span>
            <span className="text-right font-medium">{job.cancellation_reason ?? "-"}</span>
          </div>
          <div className="my-1 border-t border-black/10" />
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Job amount</span>
            <span className="font-medium">{formatCurrency(job.job_amount)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Already refunded</span>
            <span className="font-medium">{formatCurrency(job.refunded_to_client)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-black/50">Remaining owed</span>
            <span className="font-semibold text-red-600">{formatCurrency(remaining)}</span>
          </div>
        </div>

        <form onSubmit={handleProcessRefund} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Refund amount to process now</label>
            <input
              type="number"
              step="0.01"
              min="0"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={remaining > 0 ? remaining.toFixed(2) : "0.00"}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
            <p className="mt-1 text-xs text-black/50">
              Enter the amount being refunded right now. Partial refunds are fine — this job stays
              on the refund reminder list until the total refunded reaches {formatCurrency(job.job_amount)}.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-black/20 px-4 py-1.5 text-sm"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Process Refund"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RefundRequiredList({ jobs }: { jobs: RefundRequiredJob[] }) {
  const [activeJob, setActiveJob] = useState<RefundRequiredJob | null>(null);

  if (jobs.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4">
      <button
        type="button"
        onClick={() => setActiveJob(jobs[0])}
        className="mb-2 flex w-full items-center gap-2 text-left text-lg font-semibold text-red-700"
      >
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" />
        Refund Required ({jobs.length})
      </button>
      <p className="mb-2 text-sm text-red-700">
        Refund Required: A canceled job has been charged but has not yet been refunded.
      </p>
      <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-red-100 text-left">
            <tr>
              <th className="px-4 py-2 font-medium text-red-800">Actions</th>
              <th className="px-4 py-2 font-medium text-red-800">Agent</th>
              <th className="px-4 py-2 font-medium text-red-800">Job #</th>
              <th className="px-4 py-2 font-medium text-red-800">Vendor</th>
              <th className="px-4 py-2 font-medium text-red-800">Job amount</th>
              <th className="px-4 py-2 font-medium text-red-800">Refunded so far</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-red-100 hover:bg-red-50">
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setActiveJob(job)}
                    className="mr-2 font-medium text-red-700 hover:underline"
                  >
                    Process Refund
                  </button>
                  <Link
                    href={`/reports/${job.report_id}/jobs/${job.id}`}
                    target="_blank"
                    className="text-black/60 hover:text-black hover:underline"
                  >
                    View
                  </Link>
                </td>
                <td className="px-4 py-2">{job.agent ?? "-"}</td>
                <td className="px-4 py-2">{job.job_number ?? "-"}</td>
                <td className="px-4 py-2">{job.vendor_name ?? "-"}</td>
                <td className="px-4 py-2">{formatCurrency(job.job_amount)}</td>
                <td className="px-4 py-2">{formatCurrency(job.refunded_to_client)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeJob && <RefundDialog job={activeJob} onClose={() => setActiveJob(null)} />}
    </div>
  );
}

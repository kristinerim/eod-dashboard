"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEAM_MEMBERS, US_STATE_CODES, PLATFORMS } from "@/lib/constants";
import { createJob, updateJob } from "./job-actions";
import type { Job } from "./JobsTable";

const JOB_STATUS_SUGGESTIONS = [
  "Appointment",
  "Dispatched",
  "In Progress",
  "On Hold",
  "Completed",
  "Cancelled",
];

interface Props {
  reportId: string;
  job?: Job;
  onClose: () => void;
}

export default function JobForm({ reportId, job, onClose }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [jobAmount, setJobAmount] = useState(job?.job_amount?.toString() ?? "");
  const [vendorsFee, setVendorsFee] = useState(job?.vendors_fee?.toString() ?? "");

  const profitPreview =
    (Number(jobAmount) || 0) - (Number(vendorsFee) || 0);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = job
        ? await updateJob(job.id, formData)
        : await createJob(reportId, formData);

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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{job ? "Edit job" : "Add job"}</h2>
          <button onClick={onClose} className="text-black/50 hover:text-black" type="button">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent">
              <select
                name="agent"
                defaultValue={job?.agent ?? ""}
                required
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Select agent
                </option>
                {TEAM_MEMBERS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Dispatcher">
              <select
                name="dispatcher"
                defaultValue={job?.dispatcher ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              >
                <option value="">-</option>
                {TEAM_MEMBERS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Job #">
              <input
                name="job_number"
                defaultValue={job?.job_number ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Vendor name">
              <input
                name="vendor_name"
                defaultValue={job?.vendor_name ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Job amount">
              <input
                name="job_amount"
                type="number"
                step="0.01"
                value={jobAmount}
                onChange={(e) => setJobAmount(e.target.value)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Vendor fee">
              <input
                name="vendors_fee"
                type="number"
                step="0.01"
                value={vendorsFee}
                onChange={(e) => setVendorsFee(e.target.value)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Profit">
              <div className="flex h-[34px] items-center rounded border border-black/10 bg-black/5 px-2 text-sm">
                {profitPreview.toLocaleString("en-US", { style: "currency", currency: "USD" })}
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Job status">
              <input
                name="job_status"
                list="job-status-suggestions"
                defaultValue={job?.job_status ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
              <datalist id="job-status-suggestions">
                {JOB_STATUS_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="ETA (minutes)">
              <input
                name="eta_minutes"
                type="number"
                min="0"
                step="1"
                defaultValue={job?.eta_minutes?.toString() ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="State">
              <select
                name="state"
                defaultValue={job?.state ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              >
                <option value="">-</option>
                {US_STATE_CODES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-xs text-black/50">
            Setting status to &quot;Dispatched&quot; starts the ETA countdown from now, using the
            minutes entered here.
          </p>

          <Field label="Customer phone">
            <input
              name="customer_phone"
              defaultValue={job?.customer_phone ?? ""}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Charged via">
              <select
                name="customer_charged_via"
                defaultValue={job?.customer_charged_via ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              >
                <option value="">-</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paid via">
              <select
                name="vendor_paid_via"
                defaultValue={job?.vendor_paid_via ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              >
                <option value="">-</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              name="notes"
              defaultValue={job?.notes ?? ""}
              rows={2}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-black/20 px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-black/60">{label}</span>
      {children}
    </label>
  );
}

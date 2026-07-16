"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TEAM_MEMBERS,
  US_STATE_CODES,
  PLATFORMS,
  PENDING_COMPLETION_SUBSTATUSES,
} from "@/lib/constants";
import { createJob, updateJob } from "./job-actions";
import type { Job } from "./JobsTable";

const PENDING_COMPLETION_STATUS = "Service Rendered – Pending Completion";

// datetime-local inputs work in wall-clock time with no timezone; the team
// works in Philippine Time, so shift stored UTC instants into a PHT reading
// for the input's defaultValue (mirrors src/lib/aggregate.ts's dateInPHT).
function isoToDatetimeLocalPHT(iso: string | null | undefined): string {
  if (!iso) return "";
  const shifted = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

const JOB_STATUS_SUGGESTIONS = [
  "Appointment",
  "Converted",
  "Dispatched",
  "In Progress",
  "On Hold",
  "Needs Attention",
  PENDING_COMPLETION_STATUS,
  "Completed",
  "Cancelled",
];

interface Props {
  reportId: string;
  job?: Job;
  onClose: () => void;
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
}

export default function JobForm({
  reportId,
  job,
  onClose,
  agentOptions,
  currentRole,
  currentAgentName,
}: Props) {
  const agentNames = agentOptions ?? TEAM_MEMBERS;
  const isLockedToSelf = currentRole === "agent";
  const isNewJob = !job;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [jobAmount, setJobAmount] = useState(job?.job_amount?.toString() ?? "");
  const [vendorsFee, setVendorsFee] = useState(job?.vendors_fee?.toString() ?? "");
  const [refundedToClient, setRefundedToClient] = useState(job?.refunded_to_client?.toString() ?? "");
  const [jobStatus, setJobStatus] = useState(job?.job_status ?? "");
  const [vendorPaidVia, setVendorPaidVia] = useState(job?.vendor_paid_via ?? "");
  const isPendingCompletion = jobStatus === PENDING_COMPLETION_STATUS;

  const profitPreview =
    (Number(jobAmount) || 0) - (Number(vendorsFee) || 0) - (Number(refundedToClient) || 0);

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
          <SectionHeading title="Job Details" first />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent">
              {isLockedToSelf ? (
                <>
                  <div className="flex h-[34px] items-center rounded border border-black/10 bg-black/5 px-2 text-sm">
                    {currentAgentName ?? "-"}
                  </div>
                  <input type="hidden" name="agent" value={currentAgentName ?? ""} />
                </>
              ) : (
                <select
                  name="agent"
                  defaultValue={job?.agent ?? ""}
                  required
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                >
                  <option value="" disabled>
                    Select agent
                  </option>
                  {agentNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
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
            <Field label="Job # (required)">
              <input
                name="job_number"
                required
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
            <Field label="Job amount (required)">
              <input
                name="job_amount"
                type="number"
                step="0.01"
                required
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
              <select
                name="job_status"
                value={jobStatus}
                onChange={(e) => setJobStatus(e.target.value)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              >
                <option value="">-</option>
                {JOB_STATUS_SUGGESTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                {job?.job_status && !JOB_STATUS_SUGGESTIONS.includes(job.job_status) && (
                  <option value={job.job_status}>{job.job_status}</option>
                )}
              </select>
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

          {isPendingCompletion && (
            <Field label="Sub-status">
              <select
                name="pending_completion_substatus"
                defaultValue={job?.pending_completion_substatus ?? ""}
                required
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              >
                <option value="" disabled>
                  Select a sub-status
                </option>
                {PENDING_COMPLETION_SUBSTATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={isNewJob ? "Time converted (required)" : "Time converted"}>
              <input
                name="time_converted"
                type="datetime-local"
                required={isNewJob}
                defaultValue={isoToDatetimeLocalPHT(job?.time_converted)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Time dispatched (optional)">
              <input
                name="time_dispatched"
                type="datetime-local"
                defaultValue={isoToDatetimeLocalPHT(job?.time_dispatched)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
          </div>
          <p className="text-xs text-black/50">
            The ETA countdown starts from the time dispatched if entered, otherwise from when the
            status is set to &quot;Dispatched.&quot;
          </p>

          {job && (
            <Field label="Refunded to client">
              <input
                name="refunded_to_client"
                type="number"
                step="0.01"
                value={refundedToClient}
                onChange={(e) => setRefundedToClient(e.target.value)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
          )}

          <SectionHeading title="Customer Details" />

          <Field label={isNewJob ? "Customer name (required)" : "Customer name"}>
            <input
              name="customer_name"
              required={isNewJob}
              defaultValue={job?.customer_name ?? ""}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer phone">
              <input
                name="customer_phone"
                defaultValue={job?.customer_phone ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            {job && (
              <Field label="Call que">
                <input
                  name="call_que"
                  defaultValue={job.call_que ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            )}
          </div>

          <SectionHeading title="Payment Details" />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer charged via">
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
            <Field label="Vendor paid via">
              <select
                name="vendor_paid_via"
                value={vendorPaidVia}
                onChange={(e) => setVendorPaidVia(e.target.value)}
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

          {vendorPaidVia && (
            <Field label="Last 4 digits of VPC">
              <input
                name="last4_vpc"
                maxLength={4}
                defaultValue={job?.last4_vpc ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
          )}

          <SectionHeading title="Admin & Additional Notes" />

          <Field label="Notes">
            <textarea
              name="notes"
              defaultValue={job?.notes ?? ""}
              rows={2}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          {job && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Reviewed by">
                  <input
                    name="reviewed_by"
                    defaultValue={job.reviewed_by ?? ""}
                    className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="WC (entered by Jon)">
                  <input
                    name="wc_entered_by_jon"
                    defaultValue={job.wc_entered_by_jon ?? ""}
                    className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                  />
                </Field>
              </div>
              <Field label="Final checked by Zumi">
                <input
                  name="final_checked_by_zumi"
                  defaultValue={job.final_checked_by_zumi ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </>
          )}

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

function SectionHeading({ title, first }: { title: string; first?: boolean }) {
  return (
    <h3
      className={`text-sm font-semibold text-black/80 ${first ? "" : "border-t border-black/10 pt-3"}`}
    >
      {title}
    </h3>
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

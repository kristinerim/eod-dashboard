"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TEAM_MEMBERS,
  US_STATE_CODES,
  PLATFORMS,
  PENDING_COMPLETION_SUBSTATUSES,
} from "@/lib/constants";
import { convertLeadToJob } from "./lead-actions";
import type { Lead } from "./LeadsTable";

const PENDING_COMPLETION_STATUS = "Service Rendered – Pending Completion";

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

// datetime-local inputs work in wall-clock time with no timezone; the team
// works in Philippine Time (mirrors reports/[id]/JobForm.tsx's helper).
function isoToDatetimeLocalPHT(iso: string | null | undefined): string {
  if (!iso) return "";
  const shifted = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

interface Props {
  lead: Lead;
  onClose: () => void;
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
}

export default function ConvertToJobForm({
  lead,
  onClose,
  agentOptions,
  currentRole,
  currentAgentName,
}: Props) {
  const agentNames = agentOptions ?? TEAM_MEMBERS;
  const isLockedToSelf = currentRole === "agent";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [jobAmount, setJobAmount] = useState("");
  const [vendorsFee, setVendorsFee] = useState("");
  const [jobStatus, setJobStatus] = useState("Converted");
  const [timeDispatched, setTimeDispatched] = useState("");
  const [etaMinutes, setEtaMinutes] = useState("");
  const isPendingCompletion = jobStatus === PENDING_COMPLETION_STATUS;
  const isDispatchedSelected = jobStatus.trim().toLowerCase() === "dispatched";
  const needsTimeDispatched = isDispatchedSelected && !timeDispatched;
  const isAppointmentSelected = jobStatus.trim().toLowerCase() === "appointment";
  const profitPreview =
    vendorsFee.trim() === "" || isAppointmentSelected
      ? null
      : (Number(jobAmount) || 0) - (Number(vendorsFee) || 0);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await convertLeadToJob(lead.id, formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/reports/${result.reportId}/jobs/${result.jobId}`);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Convert {lead.lead_number} to a job</h2>
          <button onClick={onClose} className="text-black/50 hover:text-black" type="button">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-xs text-black/50">
            Customer details below carry over from the lead — adjust anything before saving.
          </p>

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
                  defaultValue={lead.agent ?? ""}
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
                defaultValue={lead.dispatcher ?? ""}
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
              <input name="job_number" required className="w-full rounded border border-black/20 px-2 py-1.5 text-sm" />
            </Field>
            <Field label="Vendor name">
              <input name="vendor_name" className="w-full rounded border border-black/20 px-2 py-1.5 text-sm" />
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
                {profitPreview === null
                  ? "-"
                  : profitPreview.toLocaleString("en-US", { style: "currency", currency: "USD" })}
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
                {JOB_STATUS_SUGGESTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={needsTimeDispatched ? "ETA (minutes) (required)" : "ETA (minutes)"}>
              <input
                name="eta_minutes"
                type="number"
                min="0"
                step="1"
                value={etaMinutes}
                onChange={(e) => setEtaMinutes(e.target.value)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="State">
              <select
                name="state"
                defaultValue={lead.state ?? ""}
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
                required
                defaultValue=""
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
            <Field label="Time converted (required)">
              <input
                name="time_converted"
                type="datetime-local"
                required
                defaultValue={isoToDatetimeLocalPHT(new Date().toISOString())}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label={needsTimeDispatched ? "Time dispatched (required)" : "Time dispatched (optional)"}>
              <input
                name="time_dispatched"
                type="datetime-local"
                required={needsTimeDispatched}
                value={timeDispatched}
                onChange={(e) => setTimeDispatched(e.target.value)}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
          </div>

          <Field label="Customer name (required)">
            <input
              name="customer_name"
              required
              defaultValue={lead.customer_name ?? ""}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Customer phone">
            <input
              name="customer_phone"
              defaultValue={lead.customer_phone ?? ""}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer charged via">
              <select name="customer_charged_via" defaultValue="" className="w-full rounded border border-black/20 px-2 py-1.5 text-sm">
                <option value="">-</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vendor paid via">
              <select name="vendor_paid_via" defaultValue="" className="w-full rounded border border-black/20 px-2 py-1.5 text-sm">
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
              defaultValue={lead.notes ?? ""}
              rows={2}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded border border-black/20 px-4 py-1.5 text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Converting..." : "Convert to job"}
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

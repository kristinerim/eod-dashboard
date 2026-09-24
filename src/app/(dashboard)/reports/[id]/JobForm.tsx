"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  TEAM_MEMBERS,
  US_STATE_CODES,
  PLATFORMS,
  PENDING_COMPLETION_SUBSTATUSES,
  JOB_TYPES,
} from "@/lib/constants";
import { createJob, updateJob } from "./job-actions";
import type { ContactedVendorRow } from "./job-fields";
import type { Job } from "./JobsTable";
import JobTypeFields from "./JobTypeFields";

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

export interface OpenLead {
  id: string;
  lead_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  state: string | null;
  notes: string | null;
}

type VendorRow = ContactedVendorRow & { id: string };

function newVendorRow(): VendorRow {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    vendor_name: "",
    phone_number: "",
    eta_given: "",
    goa: false,
  };
}

interface Props {
  reportId: string;
  job?: Job;
  onClose: () => void;
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
  openLeads?: OpenLead[];
  contactedVendors?: VendorRow[];
}

export default function JobForm({
  reportId,
  job,
  onClose,
  agentOptions,
  currentRole,
  currentAgentName,
  openLeads,
  contactedVendors,
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
  const [jobType, setJobType] = useState(job?.job_type ?? "");
  const [vendorPaidVia, setVendorPaidVia] = useState(job?.vendor_paid_via ?? "");
  const [timeDispatched, setTimeDispatched] = useState(isoToDatetimeLocalPHT(job?.time_dispatched));
  const [etaMinutes, setEtaMinutes] = useState(job?.eta_minutes?.toString() ?? "");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [vendorRows, setVendorRows] = useState<VendorRow[]>(contactedVendors ?? []);
  const isPendingCompletion = jobStatus === PENDING_COMPLETION_STATUS;
  const isDispatchedSelected = jobStatus.trim().toLowerCase() === "dispatched";
  const needsTimeDispatched = isDispatchedSelected && !timeDispatched;

  const selectedLead = openLeads?.find((l) => l.id === selectedLeadId) ?? null;

  // Dispatching an appointment or converted job means the ETA now measures
  // something different (time to arrival, not time to the appointment/
  // conversion) — it must be actively reconsidered at this transition, not
  // just carried over from before.
  const originalStatus = (job?.job_status ?? "").trim().toLowerCase();
  const wasAppointmentOrConverted = originalStatus === "appointment" || originalStatus === "converted";
  const originalEta = job?.eta_minutes?.toString() ?? "";
  const needsEtaUpdateOnDispatch =
    !isNewJob &&
    wasAppointmentOrConverted &&
    isDispatchedSelected &&
    (etaMinutes.trim() === "" || etaMinutes.trim() === originalEta.trim());

  const isAppointmentSelected = jobStatus.trim().toLowerCase() === "appointment";
  const profitPreview =
    vendorsFee.trim() === "" || isAppointmentSelected
      ? null
      : (Number(jobAmount) || 0) - (Number(vendorsFee) || 0) - (Number(refundedToClient) || 0);

  function addVendorRow() {
    setVendorRows((rows) => [...rows, newVendorRow()]);
  }

  function removeVendorRow(id: string) {
    setVendorRows((rows) => rows.filter((r) => r.id !== id));
  }

  function updateVendorRow(id: string, patch: Partial<VendorRow>) {
    setVendorRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (needsEtaUpdateOnDispatch) {
      setError("Update the ETA before dispatching this job.");
      return;
    }

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
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{job ? "Edit job" : "Add job"}</h2>
          <button onClick={onClose} className="text-black/50 hover:text-black" type="button">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="contacted_vendors_json" value={JSON.stringify(vendorRows)} />
          {isNewJob && selectedLeadId && <input type="hidden" name="selected_lead_id" value={selectedLeadId} />}

          {/* 1. Client Details */}
          <Section title="Client Details">
            {isNewJob && openLeads && openLeads.length > 0 && (
              <Field label="Auto-populate from an existing lead">
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                >
                  <option value="">Don&apos;t use a lead</option>
                  {openLeads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.lead_number} — {l.customer_name ?? "Unnamed"}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-black/50">
                  Fills in whatever the lead has below — everything stays editable.
                </p>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label={isNewJob ? "Client name (required)" : "Client name"}>
                <input
                  key={`customer_name-${selectedLeadId}`}
                  name="customer_name"
                  required={isNewJob}
                  defaultValue={selectedLead?.customer_name ?? job?.customer_name ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Company name">
                <input
                  name="client_company_name"
                  defaultValue={job?.client_company_name ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Phone number">
                <input
                  key={`customer_phone-${selectedLeadId}`}
                  name="customer_phone"
                  defaultValue={selectedLead?.customer_phone ?? job?.customer_phone ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Phone extension">
                <input
                  name="phone_extension"
                  defaultValue={job?.phone_extension ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Email address">
                <input
                  name="client_email"
                  type="email"
                  defaultValue={job?.client_email ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>
          </Section>

          {/* 2. Service Location */}
          <Section title="Service Location">
            <Field label="Street address">
              <input
                name="service_street_address"
                defaultValue={job?.service_street_address ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Unit / suite / apartment">
                <input
                  name="service_unit"
                  defaultValue={job?.service_unit ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="City">
                <input
                  name="service_city"
                  defaultValue={job?.service_city ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="State">
                <select
                  key={`state-${selectedLeadId}`}
                  name="state"
                  defaultValue={selectedLead?.state ?? job?.state ?? ""}
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
              <Field label="ZIP code">
                <input
                  name="service_zip"
                  defaultValue={job?.service_zip ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Country">
                <input
                  name="service_country"
                  defaultValue={job?.service_country ?? "US"}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <input
                  name="service_latitude"
                  type="number"
                  step="any"
                  defaultValue={job?.service_latitude ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Longitude">
                <input
                  name="service_longitude"
                  type="number"
                  step="any"
                  defaultValue={job?.service_longitude ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>

            <button
              type="button"
              disabled
              title="Map picker coming later — enter latitude/longitude manually for now"
              className="w-full cursor-not-allowed rounded border border-dashed border-black/20 px-2 py-2 text-xs text-black/40"
            >
              Pin on map (coming soon)
            </button>
          </Section>

          {/* 3. Job Details */}
          <Section title="Job Details">
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

            <div className="grid grid-cols-2 gap-3">
              <Field label="Job name">
                <input
                  name="job_name"
                  defaultValue={job?.job_name ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Job type">
                <select
                  name="job_type"
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value)}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                >
                  <option value="">-</option>
                  {JOB_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <JobTypeFields jobType={jobType} job={job} />

            <div className="grid grid-cols-2 gap-3">
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
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Appointment date & time">
                <input
                  name="appointment_at"
                  type="datetime-local"
                  defaultValue={isoToDatetimeLocalPHT(job?.appointment_at)}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label={isNewJob ? "Time converted (required)" : "Time converted"}>
                <input
                  name="time_converted"
                  type="datetime-local"
                  required={isNewJob}
                  defaultValue={isoToDatetimeLocalPHT(job?.time_converted)}
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
            {needsTimeDispatched ? (
              <p className="text-xs font-medium text-amber-600">
                Status is set to &quot;Dispatched&quot; — enter the time this happened to start the
                ETA countdown.
              </p>
            ) : (
              <p className="text-xs text-black/50">
                The ETA countdown always starts from the time dispatched, whether it was entered now
                or when the job was created.
              </p>
            )}
          </Section>

          {/* 4. Schedule */}
          <Section title="Schedule">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date & time">
                <input
                  name="schedule_start_at"
                  type="datetime-local"
                  defaultValue={isoToDatetimeLocalPHT(job?.schedule_start_at)}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="End date & time">
                <input
                  name="schedule_end_at"
                  type="datetime-local"
                  defaultValue={isoToDatetimeLocalPHT(job?.schedule_end_at)}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_all_day" defaultChecked={job?.is_all_day ?? false} />
              All-day event
            </label>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Assign team member">
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
                      Select team member
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

            <Link href={`/reports/${reportId}`} target="_blank" className="inline-block text-xs underline">
              View schedule for this day →
            </Link>
          </Section>

          {/* 5. Service Provider Quote */}
          <Section title="Service Provider Quote">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Service amount">
                <input
                  name="quoted_service_amount"
                  type="number"
                  step="0.01"
                  defaultValue={job?.quoted_service_amount ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label={needsEtaUpdateOnDispatch ? "ETA (minutes) (required)" : "ETA (minutes)"}>
                <input
                  name="eta_minutes"
                  type="number"
                  min="0"
                  step="1"
                  required={needsEtaUpdateOnDispatch}
                  value={etaMinutes}
                  onChange={(e) => setEtaMinutes(e.target.value)}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>
            {needsEtaUpdateOnDispatch && (
              <p className="text-xs font-medium text-amber-600">
                Status is moving from &quot;{job?.job_status}&quot; to &quot;Dispatched&quot; — update the
                ETA to reflect the actual dispatch, not the {originalStatus === "appointment" ? "appointment" : "conversion"}.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="goa" defaultChecked={job?.goa ?? false} />
              GOA (Gone on Arrival)
            </label>
          </Section>

          {/* 6. Contacted Vendors */}
          <Section title="Contacted Vendors">
            <p className="text-xs text-black/50">
              Basic structure for now — this will connect to the Vendor Map later.
            </p>
            <div className="space-y-2">
              {vendorRows.map((row) => (
                <div key={row.id} className="grid grid-cols-12 items-end gap-2 rounded border border-black/10 p-2">
                  <div className="col-span-4">
                    <Field label="Vendor name">
                      <input
                        value={row.vendor_name ?? ""}
                        onChange={(e) => updateVendorRow(row.id, { vendor_name: e.target.value })}
                        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="col-span-3">
                    <Field label="Phone number">
                      <input
                        value={row.phone_number ?? ""}
                        onChange={(e) => updateVendorRow(row.id, { phone_number: e.target.value })}
                        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="ETA given">
                      <input
                        value={row.eta_given ?? ""}
                        onChange={(e) => updateVendorRow(row.id, { eta_given: e.target.value })}
                        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="col-span-2 flex h-[34px] items-center gap-1">
                    <input
                      type="checkbox"
                      checked={row.goa}
                      onChange={(e) => updateVendorRow(row.id, { goa: e.target.checked })}
                    />
                    <span className="text-xs">GOA</span>
                  </div>
                  <div className="col-span-1">
                    <button
                      type="button"
                      onClick={() => removeVendorRow(row.id)}
                      className="h-[34px] w-full rounded border border-black/20 text-xs text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addVendorRow}
              className="rounded border border-black/20 px-3 py-1.5 text-xs"
            >
              + Add contacted vendor
            </button>
          </Section>

          {/* 7. Additional Quotes / Payment Information */}
          <Section title="Additional Quotes / Payment Information">
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
              <Field label="Vendor card (last 4 digits)">
                <input
                  name="last4_vpc"
                  maxLength={4}
                  defaultValue={job?.last4_vpc ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Card expiry (MM/YY)">
                <input
                  name="card_expiry"
                  placeholder="MM/YY"
                  defaultValue={job?.card_expiry ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Billing address">
                <input
                  name="billing_address"
                  defaultValue={job?.billing_address ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            </div>
            <p className="text-xs text-black/50">
              Only the last 4 digits, expiry, and billing address are stored — never the full card
              number or CVV.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <Field label="TL quote">
                <input
                  name="tl_quote"
                  type="number"
                  step="0.01"
                  defaultValue={job?.tl_quote ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="TL ETA (minutes)">
                <input
                  name="tl_eta_minutes"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={job?.tl_eta_minutes ?? ""}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label="Quoted by dispatcher">
                <select
                  name="quoted_by_dispatcher"
                  defaultValue={job?.quoted_by_dispatcher ?? ""}
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
          </Section>

          {/* Existing admin/notes fields — not part of the 7 new sections, kept as-is */}
          <Section title="Notes & Admin">
            <Field label="Notes">
              <textarea
                key={`notes-${selectedLeadId}`}
                name="notes"
                defaultValue={selectedLead?.notes ?? job?.notes ?? ""}
                rows={2}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>

            {job && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Call que">
                    <input
                      name="call_que"
                      defaultValue={job.call_que ?? ""}
                      className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label="Reviewed by">
                    <input
                      name="reviewed_by"
                      defaultValue={job.reviewed_by ?? ""}
                      className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="WC (entered by Jon)">
                    <input
                      name="wc_entered_by_jon"
                      defaultValue={job.wc_entered_by_jon ?? ""}
                      className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label="Final checked by Zumi">
                    <input
                      name="final_checked_by_zumi"
                      defaultValue={job.final_checked_by_zumi ?? ""}
                      className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                    />
                  </Field>
                </div>
              </>
            )}
          </Section>

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-black/10 p-3">
      <h3 className="text-sm font-semibold text-black/80">{title}</h3>
      {children}
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

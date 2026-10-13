"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  TEAM_MEMBERS,
  PLATFORMS,
  PAYMENT_AUTH_STATUSES,
  PENDING_COMPLETION_STATUS,
  PENDING_COMPLETION_SUBSTATUSES,
  JOB_STATUS_SUGGESTIONS,
} from "@/lib/constants";
import {
  INTAKE_STEPS,
  buildIntakeSummary,
  intakeInitialFromRecord,
  type IntakeStepId,
} from "@/lib/intake";
import { autosaveVendorDispatch, createJob, saveCustomerPaymentStep, updateJob } from "./job-actions";
import type { ContactedVendorRow } from "./job-fields";
import type { Job } from "./JobsTable";
import { listApproverNames } from "../../intake/vendor-search-actions";
import RecommendedVendors, { type RowPatch, type VendorRef } from "../../intake/RecommendedVendors";
import { setFieldValue } from "../../intake/useFormSnapshot";
import { needsTeamLeaderApproval } from "@/lib/vendorSearch";
import { parseEtaMinutes, preferredVendorAnswer, type ContactStatus, type DropdownStatus } from "@/lib/vendorStatus";
import { formatPhoneDisplay } from "@/lib/vendors";
import IntakeShell, { StepPanel } from "../../intake/IntakeShell";
import { useFormSnapshot } from "../../intake/useFormSnapshot";
import {
  Field,
  SelectField,
  TextAreaField,
  TextField,
  ServiceStep,
  LocationStep,
  VehicleStep,
  CustomerStep,
  QuoteStep,
} from "../../intake/IntakePanels";

// datetime-local inputs work in wall-clock time with no timezone; the team
// works in Philippine Time, so shift stored UTC instants into a PHT reading
// for the input's defaultValue (mirrors src/lib/aggregate.ts's dateInPHT).
function isoToDatetimeLocalPHT(iso: string | null | undefined): string {
  if (!iso) return "";
  const shifted = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

// A lead being picked to pre-fill a new job — the whole row, since the lead
// now carries the full intake (service, location, vehicle, quote...).
export interface OpenLead {
  id: string;
  lead_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  state: string | null;
  notes: string | null;
  [key: string]: unknown;
}

type VendorRow = ContactedVendorRow & { id: string };

function newVendorRow(): VendorRow {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
    vendor_name: "",
    phone_number: "",
    eta_given: "",
    goa: false,
    goa_amount: null,
    vendor_id: null,
    quote_amount: null,
    notes: null,
    vendor_tier: null,
    tl_approved_by: null,
    status: "called",
    is_assigned: false,
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
  // Opened right after "Customer Proceed -> Create Job": the job already exists,
  // was created from this lead, and the form lands on `startStep`.
  createdFromLead?: string;
  startStep?: IntakeStepId;
}

// In a job the last step is the full dispatch/operations area, not just a
// conversion handoff.
const JOB_STEPS = INTAKE_STEPS.map((s) =>
  s.id === "convert"
    ? { ...s, title: "Dispatch & Operations", prompt: "Assign, schedule, and dispatch the job." }
    : s.id === "customer"
      ? {
          ...s,
          title: "Customer & Payment Information",
          prompt: "Let me confirm your details, and I'll take your payment information to secure the service.",
        }
      : s
);

export default function JobForm({
  reportId,
  job,
  onClose,
  agentOptions,
  currentRole,
  currentAgentName,
  openLeads,
  contactedVendors,
  createdFromLead,
  startStep,
}: Props) {
  const agentNames = agentOptions ?? TEAM_MEMBERS;
  const isLockedToSelf = currentRole === "agent";
  const isNewJob = !job;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<IntakeStepId>(startStep ?? "service");
  const [vendorsFee, setVendorsFee] = useState(job?.vendors_fee?.toString() ?? "");
  const [refundedToClient, setRefundedToClient] = useState(job?.refunded_to_client?.toString() ?? "");
  const [jobStatus, setJobStatus] = useState(job?.job_status ?? "");
  const [vendorPaidVia, setVendorPaidVia] = useState(job?.vendor_paid_via ?? "");
  const [timeDispatched, setTimeDispatched] = useState(isoToDatetimeLocalPHT(job?.time_dispatched));
  const [etaMinutes, setEtaMinutes] = useState(job?.eta_minutes?.toString() ?? "");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [vendorRows, setVendorRows] = useState<VendorRow[]>(contactedVendors ?? []);
  const [approvers, setApprovers] = useState<string[] | null>(null);
  const [goa, setGoa] = useState(job?.goa ?? false);
  const [goaAmount, setGoaAmount] = useState(job?.goa_amount?.toString() ?? "");
  const isPendingCompletion = jobStatus === PENDING_COMPLETION_STATUS;
  const isDispatchedSelected = jobStatus.trim().toLowerCase() === "dispatched";
  const needsTimeDispatched = isDispatchedSelected && !timeDispatched;

  const selectedLead = openLeads?.find((l) => l.id === selectedLeadId) ?? null;

  // Every intake field's starting value, whether from the job being edited, a
  // lead picked to pre-fill a new job, or nothing.
  const initial = useMemo(() => {
    const base = intakeInitialFromRecord(selectedLead ?? job);
    if (!base.service_country) base.service_country = "US";
    if (selectedLead && !job) {
      const total = (Number(selectedLead.quoted_price) || 0) + (Number(selectedLead.additional_charges) || 0);
      if (total) base.job_amount = String(total);
    }
    return base;
  }, [selectedLead, job]);

  const { formRef, snapshot, sync, formHandlers } = useFormSnapshot(initial);
  useEffect(() => {
    sync();
  }, [selectedLeadId, sync]);

  const jobType = snapshot.job_type ?? initial.job_type ?? "";
  const steps = JOB_STEPS;
  const summary = buildIntakeSummary({ ...snapshot, job_status: jobStatus }, "job");

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
      : (Number(snapshot.job_amount) || 0) - (Number(vendorsFee) || 0) - (Number(refundedToClient) || 0);

  // A vendor's response on this job. Not Contacted has no row; Called, No-Go and
  // Go are rows in Contacted Vendors, each with its own quote, GOA, ETA and notes.
  function rowFor(v: VendorRef, status: ContactStatus): VendorRow {
    return {
      ...newVendorRow(),
      vendor_name: v.name,
      phone_number: formatPhoneDisplay(v.phone),
      vendor_id: v.id,
      vendor_tier: v.tier,
      status,
      is_assigned: status === "go",
    };
  }

  function rowHasDetails(r: VendorRow) {
    return Boolean(r.quote_amount !== null || r.goa_amount !== null || r.notes || r.eta_given || r.goa || r.tl_approved_by);
  }

  // Only one vendor can be Go (assigned). Choosing a new Go vendor turns the
  // previous one into No-Go — its quote, GOA, ETA and notes are kept as history.
  function withStatus(rows: VendorRow[], isTarget: (r: VendorRow) => boolean, status: ContactStatus): VendorRow[] {
    return rows.map((r) => {
      if (isTarget(r)) return { ...r, status, is_assigned: status === "go" };
      if (status === "go" && r.status === "go") return { ...r, status: "no_go" as const, is_assigned: false };
      return r;
    });
  }

  // From the Recommended Vendors list (a directory vendor, with or without a row yet).
  function setVendorStatus(v: VendorRef, status: DropdownStatus) {
    if (status === "not_contacted") {
      const row = vendorRows.find((r) => r.vendor_id === v.id);
      if (!row) return;
      if (
        rowHasDetails(row) &&
        !window.confirm(`Mark ${v.name} as Not Contacted? Its quote, GOA, ETA and notes will be deleted.`)
      ) {
        return;
      }
      commitVendorRows(vendorRows.filter((r) => r.id !== row.id));
      return;
    }
    commitVendorRows(
      withStatus(
        vendorRows.some((r) => r.vendor_id === v.id) ? vendorRows : [...vendorRows, rowFor(v, status)],
        (r) => r.vendor_id === v.id,
        status
      )
    );
  }

  // For vendors already on the job that aren't in the current search — including
  // vendors typed in by hand. Not Contacted takes the vendor off the job.
  function setRowStatus(rowId: string, status: DropdownStatus) {
    const row = vendorRows.find((r) => r.id === rowId);
    if (!row) return;
    if (status === "not_contacted") {
      if (
        rowHasDetails(row) &&
        !window.confirm(`Remove ${row.vendor_name || "this vendor"} from the job? Its quote, GOA, ETA and notes will be deleted.`)
      ) {
        return;
      }
      commitVendorRows(vendorRows.filter((r) => r.id !== rowId));
      return;
    }
    commitVendorRows(withStatus(vendorRows, (r) => r.id === rowId, status));
  }

  // A vendor that isn't in the Vendors directory.
  function addManualVendor() {
    setVendorRows((rows) => [...rows, newVendorRow()]);
  }

  function editVendorRow(rowId: string, patch: RowPatch) {
    commitVendorRows(vendorRows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }

  // The Job Details / Dispatch & Operations fields the Go vendor fills in. They
  // reuse the job's existing fields; nothing new is created for the vendor.
  const goSignature = (r: VendorRow | null) =>
    r ? JSON.stringify([r.vendor_name, r.phone_number, r.vendor_tier, r.quote_amount, r.goa_amount, r.eta_given]) : "";

  // Every change to the vendor rows goes through here: if the Go vendor (or one
  // of its figures) changed, the job's own fields follow; if nobody is Go any
  // more, only what that vendor filled in is taken back.
  function commitVendorRows(next: VendorRow[]) {
    const before = vendorRows.find((r) => r.status === "go") ?? null;
    const after = next.find((r) => r.status === "go") ?? null;
    setVendorRows(next);
    if (after) {
      if (goSignature(before) !== goSignature(after)) fillJobFromVendor(after);
    } else if (before) {
      clearJobFromVendor(before);
    }
  }

  function fillJobFromVendor(row: VendorRow) {
    const form = formRef.current;
    setFieldValue(form, "vendor_name", row.vendor_name ?? "");
    if (row.vendor_tier) setFieldValue(form, "preferred_vendor", preferredVendorAnswer(row.vendor_tier));
    setFieldValue(form, "vendor_phone", row.phone_number ?? "");
    setFieldValue(form, "quoted_service_amount", row.quote_amount === null ? "" : String(row.quote_amount));
    setGoaAmount(row.goa_amount === null ? "" : String(row.goa_amount));
    const minutes = parseEtaMinutes(row.eta_given);
    if (minutes !== null) setEtaMinutes(String(minutes));
  }

  // When the vendor is no longer Go, take back only what they filled in, and
  // leave anything the agent has since typed over.
  function clearJobFromVendor(row: VendorRow) {
    const form = formRef.current;
    const value = (name: string) => (form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    if (value("vendor_name") === (row.vendor_name ?? "")) setFieldValue(form, "vendor_name", "");
    if (row.vendor_tier && value("preferred_vendor") === preferredVendorAnswer(row.vendor_tier)) {
      setFieldValue(form, "preferred_vendor", "");
    }
    if (value("vendor_phone") === (row.phone_number ?? "")) setFieldValue(form, "vendor_phone", "");
    if (row.quote_amount !== null && value("quoted_service_amount") === String(row.quote_amount)) {
      setFieldValue(form, "quoted_service_amount", "");
    }
    if (row.goa_amount !== null && goaAmount === String(row.goa_amount)) setGoaAmount("");
    const minutes = parseEtaMinutes(row.eta_given);
    if (minutes !== null && etaMinutes === String(minutes)) setEtaMinutes("");
  }

  // Only fetched when a Tier 1 / 2 vendor is actually in the list.
  const anyNeedsApproval = vendorRows.some((r) => needsTeamLeaderApproval(r.vendor_tier));
  useEffect(() => {
    if (anyNeedsApproval && approvers === null) listApproverNames().then(setApprovers).catch(() => setApprovers([]));
  }, [anyNeedsApproval, approvers]);

  // Vendor information is saved as the agent works (once the job exists), so a
  // quote or a Go isn't lost if the window is closed before pressing Save.
  const lastSavedVendors = useRef(JSON.stringify(contactedVendors ?? []));
  const [autosaveNote, setAutosaveNote] = useState<string | null>(null);
  useEffect(() => {
    if (!job || isPending) return;
    const rowsJson = JSON.stringify(vendorRows);
    if (rowsJson === lastSavedVendors.current) return;
    const timer = setTimeout(async () => {
      const form = formRef.current;
      const read = (name: string) => (form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
      const result = await autosaveVendorDispatch(job.id, {
        rowsJson,
        job: {
          vendor_name: read("vendor_name"),
          preferred_vendor: read("preferred_vendor"),
          vendor_phone: read("vendor_phone"),
          quoted_service_amount: read("quoted_service_amount"),
          goa_amount: goaAmount,
          eta_minutes: etaMinutes,
        },
      });
      if ("error" in result) {
        setAutosaveNote(`Not saved yet: ${result.error}`);
        return;
      }
      lastSavedVendors.current = rowsJson;
      setAutosaveNote("Vendor information saved ✓");
    }, 1500);
    return () => clearTimeout(timer);
    // goaAmount / etaMinutes are read when the timer fires; they follow the vendor rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorRows, job, isPending]);

  // "Continue to Dispatch & Operations": save the customer and payment details on
  // their own (the rest of the job is saved later), then open Dispatch &
  // Operations on the same job.
  const [continueError, setContinueError] = useState<string | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  async function continueToDispatch() {
    setContinueError(null);
    if (!job) {
      setActive("convert");
      return;
    }
    const form = formRef.current;
    const read = (name: string) => (form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
    setIsContinuing(true);
    const result = await saveCustomerPaymentStep(job.id, {
      customer_name: read("customer_name"),
      client_company_name: read("client_company_name"),
      customer_phone: read("customer_phone"),
      phone_extension: read("phone_extension"),
      client_email: read("client_email"),
      caller_id: read("caller_id"),
      customer_billing_address: read("customer_billing_address"),
      customer_billing_zip: read("customer_billing_zip"),
      payment_authorization_status: read("payment_authorization_status"),
      customer_card_last4: read("customer_card_last4"),
    });
    setIsContinuing(false);
    if ("error" in result) {
      setContinueError(result.error);
      return;
    }
    setActive("convert");
  }

  function jump(step: IntakeStepId, message: string) {
    setActive(step);
    setError(message);
  }

  function handleSubmit() {
    setError(null);
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const text = (name: string) => String(formData.get(name) ?? "").trim();

    // Every step stays mounted (just hidden), so the browser can't be asked to
    // validate them — check the required ones here and jump to the step that
    // needs attention. The server re-checks all of this.
    if (!text("agent")) return jump("convert", "Select the team member for this job.");
    if (isNewJob && !text("customer_name")) return jump("customer", "Enter the customer name.");
    if (!text("job_number")) return jump("convert", "Enter the job number.");
    if (!text("job_amount")) return jump("quote", "Enter the job amount.");
    if (isNewJob && !text("time_converted")) return jump("convert", "Enter the time converted.");
    if (isPendingCompletion && !text("pending_completion_substatus")) {
      return jump("convert", "Select a sub-status for Service Rendered – Pending Completion.");
    }
    if (needsTimeDispatched) return jump("convert", "Enter the time dispatched.");
    if (needsEtaUpdateOnDispatch) return jump("convert", "Update the ETA before dispatching this job.");
    if (goa && goaAmount.trim() === "") return jump("convert", "Enter the GOA amount.");

    const vendorMissingGoaAmount = vendorRows.find((r) => r.goa && r.goa_amount === null);
    if (vendorMissingGoaAmount) {
      return jump(
        "convert",
        `Enter the GOA amount for ${vendorMissingGoaAmount.vendor_name || "the contacted vendor"}.`
      );
    }

    const vendorNeedingApproval = vendorRows.find((r) => needsTeamLeaderApproval(r.vendor_tier) && !r.tl_approved_by);
    if (vendorNeedingApproval) {
      return jump(
        "convert",
        `Select the team leader who approved using ${vendorNeedingApproval.vendor_name || "the contacted vendor"}.`
      );
    }

    startTransition(async () => {
      const result = job ? await updateJob(job.id, formData) : await createJob(reportId, formData);

      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (createdFromLead && job) {
        // The job was created from a lead: finish on the job's own page.
        router.push(`/reports/${("reportId" in result && result.reportId) || reportId}/jobs/${job.id}`);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const stepDef = (id: IntakeStepId) => steps.find((s) => s.id === id) ?? JOB_STEPS.find((s) => s.id === id)!;

  const completed: Partial<Record<IntakeStepId, boolean>> = {
    service: !!snapshot.job_type,
    location: !!(snapshot.service_street_address || snapshot.service_city),
    vehicle: !!(snapshot.vehicle_make || snapshot.vehicle_model || snapshot.vehicle_year || snapshot.issue),
    customer: !!(snapshot.customer_name && snapshot.customer_phone),
    quote: !!snapshot.job_amount,
    convert: !!snapshot.job_number,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{job ? "Edit job" : "Add job"}</h2>
          <button onClick={onClose} className="text-black/50 hover:text-black" type="button">
            ✕
          </button>
        </div>

        <form ref={formRef} {...formHandlers} onSubmit={(e) => e.preventDefault()} noValidate className="space-y-3">
          <input type="hidden" name="contacted_vendors_json" value={JSON.stringify(vendorRows)} />
          {isNewJob && selectedLeadId && <input type="hidden" name="selected_lead_id" value={selectedLeadId} />}

          {createdFromLead && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 text-sm">
              Job created from lead <span className="font-semibold">{createdFromLead}</span>. Everything collected on
              the call is already here — confirm the customer and payment details, then continue to Dispatch &amp;
              Operations.
            </div>
          )}

          {isNewJob && openLeads && openLeads.length > 0 && (
            <div className="rounded-lg bg-black/[0.03] p-2.5 sm:max-w-md">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-black/60">Auto-populate from an existing lead</span>
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
              </label>
              <p className="mt-1 text-xs text-black/50">
                Fills in everything the lead collected — service, location, vehicle, customer, and quote. All of it
                stays editable.
              </p>
            </div>
          )}

          <IntakeShell
            steps={steps}
            active={active}
            onSelect={setActive}
            summary={summary}
            completed={completed}
            footer={
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-black/20 px-4 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isPending}
                  className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save"}
                </button>
              </>
            }
          >
            <Fragment key={selectedLeadId}>
              <StepPanel step={stepDef("service")} active={active}>
                <ServiceStep values={initial} />
              </StepPanel>
              <StepPanel step={stepDef("location")} active={active}>
                <LocationStep values={initial} formRef={formRef} jobType={jobType} snapshot={snapshot} />
              </StepPanel>
              <StepPanel step={stepDef("vehicle")} active={active}>
                <VehicleStep values={initial} jobType={jobType} formRef={formRef} />
              </StepPanel>
              <StepPanel step={stepDef("customer")} active={active}>
                <CustomerStep values={initial} formRef={formRef} excludeLeadId={undefined}>
                  <div className="grid grid-cols-3 gap-3">
                    <TextField
                      name="customer_billing_address"
                      label="Billing address"
                      values={initial}
                      className="col-span-2"
                    />
                    <Field label="ZIP code">
                      <input
                        name="customer_billing_zip"
                        inputMode="numeric"
                        defaultValue={(job?.customer_billing_zip as string | null | undefined) ?? ""}
                        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>

                  <div className="space-y-3 rounded-lg border border-black/10 p-3">
                    <h4 className="text-sm font-semibold text-black/80">Payment information</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <SelectField
                        name="payment_authorization_status"
                        label="Payment status"
                        values={initial}
                        options={PAYMENT_AUTH_STATUSES}
                      />
                      <TextField
                        name="customer_card_last4"
                        label="Card on file (last 4 digits)"
                        values={initial}
                        maxLength={4}
                        inputMode="numeric"
                      />
                    </div>
                    {/^\d{4}$/.test(snapshot.customer_card_last4 ?? "") && (
                      <p className="text-sm">
                        Card on file: <span className="font-mono">**** **** **** {snapshot.customer_card_last4}</span>
                      </p>
                    )}
                    <p className="text-xs text-black/50">
                      Secure card entry (card number, expiry and CVV through the payment provider) isn&apos;t connected
                      yet. Until it is, record only the last 4 digits here — never the full card number or CVV.
                    </p>
                  </div>

                  {continueError && <p className="text-sm text-red-600">{continueError}</p>}
                  <div className="flex justify-end border-t border-black/10 pt-3">
                    <button
                      type="button"
                      onClick={continueToDispatch}
                      disabled={isContinuing}
                      className="rounded bg-green-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {isContinuing ? "Saving..." : "Continue to Dispatch & Operations →"}
                    </button>
                  </div>
                </CustomerStep>
              </StepPanel>
              <StepPanel step={stepDef("quote")} active={active}>
                <QuoteStep values={initial} snapshot={snapshot} mode="job" />
              </StepPanel>
            </Fragment>

            <StepPanel step={stepDef("convert")} active={active}>
              <RecommendedVendors
                snapshot={snapshot}
                contacted={vendorRows}
                approvers={approvers ?? []}
                savedNote={autosaveNote}
                onStatus={setVendorStatus}
                onRowStatus={setRowStatus}
                onEdit={editVendorRow}
                onAddManual={addManualVendor}
              />

              <Section title="Job Details">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Job # (required)">
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
                  <TextField name="preferred_vendor" label="Preferred vendor" values={initial} />
                  <Field label="Vendor phone">
                    <input
                      name="vendor_phone"
                      inputMode="tel"
                      defaultValue={(job?.vendor_phone as string | null | undefined) ?? ""}
                      className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                    />
                  </Field>
                </div>

                <Field label="Job name">
                  <input
                    name="job_name"
                    defaultValue={job?.job_name ?? ""}
                    className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                  />
                </Field>

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
                      defaultValue={isoToDatetimeLocalPHT(job?.time_converted)}
                      className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label={needsTimeDispatched ? "Time dispatched (required)" : "Time dispatched (optional)"}>
                    <input
                      name="time_dispatched"
                      type="datetime-local"
                      value={timeDispatched}
                      onChange={(e) => setTimeDispatched(e.target.value)}
                      className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                    />
                  </Field>
                </div>
                {needsTimeDispatched ? (
                  <p className="text-xs font-medium text-amber-600">
                    Status is set to &quot;Dispatched&quot; — enter the time this happened to start the ETA
                    countdown.
                  </p>
                ) : (
                  <p className="text-xs text-black/50">
                    The ETA countdown always starts from the time dispatched, whether it was entered now or when
                    the job was created.
                  </p>
                )}
              </Section>

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
                    defaultValue={job?.agent ?? initial.agent ?? ""}
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
                  defaultValue={job?.dispatcher ?? initial.dispatcher ?? ""}
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
              <input
                type="checkbox"
                name="goa"
                checked={goa}
                onChange={(e) => setGoa(e.target.checked)}
              />
              GOA (Gone on Arrival)
            </label>
            {(goa || goaAmount !== "") && (
              <Field label={goa ? "GOA amount (required)" : "GOA amount"}>
                <input
                  name="goa_amount"
                  type="number"
                  step="0.01"
                  value={goaAmount}
                  onChange={(e) => setGoaAmount(e.target.value)}
                  className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                />
              </Field>
            )}
          </Section>



          <Section title="Payment & Vendor Costs">
            <div className="grid grid-cols-2 gap-3">
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


          <Section title="Notes & Admin">
            <TextAreaField name="notes" label="Notes" values={initial} rows={2} />
            <TextAreaField name="dispatch_notes" label="Dispatch notes" values={initial} rows={2} />

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

            </StepPanel>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          </IntakeShell>
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

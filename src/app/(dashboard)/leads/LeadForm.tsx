"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TEAM_MEMBERS,
  PLATFORMS,
  PAYMENT_AUTH_STATUSES,
  JOB_STATUS_SUGGESTIONS,
  PENDING_COMPLETION_STATUS,
  PENDING_COMPLETION_SUBSTATUSES,
  QUOTE_STATUS_LABELS,
  type QuoteStatus,
} from "@/lib/constants";
import { INTAKE_STEPS, buildIntakeSummary, intakeInitialFromRecord, type IntakeStepId } from "@/lib/intake";
import { saveLead, convertLeadToJob, type SaveLeadIntent } from "./lead-actions";
import type { Lead } from "./LeadsTable";
import IntakeShell, { StepPanel } from "../intake/IntakeShell";
import { useFormSnapshot } from "../intake/useFormSnapshot";
import {
  Field,
  SelectField,
  TextAreaField,
  TextField,
  ServiceStep,
  LocationStep,
  VehicleStep,
  DetailsStep,
  CustomerStep,
  QuoteStep,
  inputCls,
} from "../intake/IntakePanels";

// datetime-local inputs work in wall-clock time with no timezone; the team
// works in Philippine Time (mirrors reports/[id]/JobForm.tsx's helper).
function isoToDatetimeLocalPHT(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

interface Props {
  lead?: Lead;
  onClose: () => void;
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
  // Opened from "Convert to job" on an existing lead — the agent has already
  // decided to book it, so land on the booking step with the quote accepted.
  startAtConvert?: boolean;
}

const QUOTE_RESULT: Record<SaveLeadIntent, QuoteStatus | null> = {
  save: null,
  quote: "quoted",
  accepted: "accepted",
  declined: "declined",
  follow_up: "follow_up",
};

export default function LeadForm({
  lead,
  onClose,
  agentOptions,
  currentRole,
  currentAgentName,
  startAtConvert,
}: Props) {
  const agentNames = agentOptions ?? TEAM_MEMBERS;
  const isLockedToSelf = currentRole === "agent";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [initial] = useState(() => {
    const base = intakeInitialFromRecord(lead);
    if (!lead && isLockedToSelf) base.agent = currentAgentName ?? "";
    if (!base.service_country) base.service_country = "US";
    return base;
  });
  const [leadId, setLeadId] = useState<string | null>(lead?.id ?? null);
  const [leadNumber, setLeadNumber] = useState<string | null>(lead?.lead_number ?? null);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>(
    startAtConvert ? "accepted" : (lead?.quote_status ?? "quoting")
  );
  const [active, setActive] = useState<IntakeStepId>(startAtConvert ? "convert" : "service");
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [jobAmountEdited, setJobAmountEdited] = useState(false);
  const [jobAmountValue, setJobAmountValue] = useState("");
  const [timeConvertedDefault] = useState(() => isoToDatetimeLocalPHT(new Date().toISOString()));

  const { formRef, snapshot, formHandlers } = useFormSnapshot({ ...initial, quote_status: quoteStatus });
  const jobType = snapshot.job_type ?? initial.job_type ?? "";
  const accepted = quoteStatus === "accepted";

  const steps = INTAKE_STEPS;

  // The job amount defaults to whatever was quoted, but stays editable.
  const quoteTotal = (Number(snapshot.quoted_price) || 0) + (Number(snapshot.additional_charges) || 0);
  const jobAmount = jobAmountEdited ? jobAmountValue : quoteTotal ? String(quoteTotal) : "";
  const vendorCost = Number(snapshot.vendors_fee) || Number(snapshot.quoted_service_amount) || 0;
  const estimatedProfit = vendorCost ? (Number(jobAmount) || 0) - vendorCost : null;

  const summary = buildIntakeSummary({ ...snapshot, quote_status: quoteStatus }, "lead");

  const completed: Partial<Record<IntakeStepId, boolean>> = {
    service: !!snapshot.job_type,
    location: !!(snapshot.service_street_address || snapshot.service_city),
    vehicle: !!(snapshot.vehicle_make || snapshot.vehicle_model || snapshot.vehicle_year),
    details: !!snapshot.issue,
    customer: !!(snapshot.customer_name && snapshot.customer_phone),
    quote: !!snapshot.quoted_price,
    convert: false,
  };

  function submit(intent: SaveLeadIntent, after: "stay" | "close" | "convert-step") {
    setError(null);
    setSavedNote(null);
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await saveLead(leadId, formData, intent);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setLeadId(result.id);
      setLeadNumber(result.leadNumber);
      const resulting = QUOTE_RESULT[intent];
      if (resulting) setQuoteStatus(resulting);
      router.refresh();

      if (after === "close") return onClose();
      if (after === "convert-step") setActive("convert");
      setSavedNote(`Saved ${result.leadNumber}`);
    });
  }

  function handleDeclined() {
    if (!confirm("Mark this lead as lost — customer declined the quote?")) return;
    submit("declined", "close");
  }

  function jump(step: IntakeStepId, message: string) {
    setActive(step);
    setError(message);
  }

  function handleConvert() {
    setError(null);
    setSavedNote(null);
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const text = (name: string) => String(formData.get(name) ?? "").trim();

    if (!text("agent")) return jump("service", "Select the agent for this lead.");
    if (!text("customer_name")) return jump("customer", "Enter the customer name before converting.");
    if (!text("job_number")) return jump("convert", "Enter the job number.");
    if (!text("job_amount")) return jump("convert", "Enter the job amount.");
    if (!text("time_converted")) return jump("convert", "Enter the time converted.");

    startTransition(async () => {
      const saved = await saveLead(leadId, formData, "accepted");
      if ("error" in saved) {
        setError(saved.error);
        return;
      }
      setLeadId(saved.id);
      setLeadNumber(saved.leadNumber);

      const converted = await convertLeadToJob(saved.id, formData);
      if ("error" in converted) {
        setError(converted.error);
        return;
      }
      router.push(`/reports/${converted.reportId}/jobs/${converted.jobId}`);
    });
  }

  const stepDef = (id: IntakeStepId) => INTAKE_STEPS.find((s) => s.id === id)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {lead ? `Edit lead ${lead.lead_number}` : leadNumber ? `Lead ${leadNumber}` : "Create lead"}
          </h2>
          <button onClick={onClose} className="text-black/50 hover:text-black" type="button">
            ✕
          </button>
        </div>

        <form ref={formRef} {...formHandlers} onSubmit={(e) => e.preventDefault()} noValidate>
          <input type="hidden" name="quote_status" value={quoteStatus} />

          <div className="mb-3 grid grid-cols-2 gap-3 rounded-lg bg-black/[0.03] p-2.5 sm:max-w-md">
            <Field label="Agent">
              {isLockedToSelf ? (
                <>
                  <div className="flex h-[34px] items-center rounded border border-black/10 bg-black/5 px-2 text-sm">
                    {currentAgentName ?? "-"}
                  </div>
                  <input type="hidden" name="agent" value={currentAgentName ?? ""} />
                </>
              ) : (
                <select name="agent" defaultValue={initial.agent ?? ""} className={inputCls}>
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
            <SelectField name="dispatcher" label="Dispatcher" values={initial} options={TEAM_MEMBERS} />
          </div>

          <IntakeShell
            steps={steps}
            active={active}
            onSelect={setActive}
            summary={summary}
            completed={completed}
            footer={
              <>
                {savedNote && <span className="self-center text-xs text-green-700">{savedNote} ✓</span>}
                <button
                  type="button"
                  onClick={() => submit("save", "stay")}
                  disabled={isPending}
                  className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save lead"}
                </button>
              </>
            }
          >
            <StepPanel step={stepDef("service")} active={active}>
              <ServiceStep values={initial} />
            </StepPanel>
            <StepPanel step={stepDef("location")} active={active}>
              <LocationStep values={initial} formRef={formRef} jobType={jobType} snapshot={snapshot} />
            </StepPanel>
            <StepPanel step={stepDef("vehicle")} active={active}>
              <VehicleStep values={initial} jobType={jobType} />
            </StepPanel>
            <StepPanel step={stepDef("details")} active={active}>
              <DetailsStep values={initial} jobType={jobType} />
            </StepPanel>
            <StepPanel step={stepDef("customer")} active={active}>
              <CustomerStep values={initial} formRef={formRef} excludeLeadId={lead?.id}>
                <div className="grid grid-cols-2 gap-3">
                  <TextField name="source" label="Source" values={initial} placeholder="e.g. phone, website, referral" />
                </div>
                <TextAreaField name="notes" label="Call notes" values={initial} rows={2} />
              </CustomerStep>
            </StepPanel>

            <StepPanel step={stepDef("quote")} active={active}>
              <QuoteStep values={initial} snapshot={snapshot} mode="lead">
                <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3">
                  <span className="text-xs text-black/50">
                    Status: <span className="font-medium text-black/80">{QUOTE_STATUS_LABELS[quoteStatus]}</span>
                  </span>
                  <span className="grow" />
                  <button
                    type="button"
                    onClick={() => submit("quote", "stay")}
                    disabled={isPending}
                    className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Save Quote
                  </button>
                  <button
                    type="button"
                    onClick={() => submit("follow_up", "close")}
                    disabled={isPending}
                    className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Follow-Up Needed
                  </button>
                  <button
                    type="button"
                    onClick={handleDeclined}
                    disabled={isPending}
                    className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                  >
                    Customer Declined
                  </button>
                  <button
                    type="button"
                    onClick={() => submit("accepted", "convert-step")}
                    disabled={isPending}
                    className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Customer Accepted
                  </button>
                </div>
              </QuoteStep>
            </StepPanel>

            <StepPanel step={stepDef("convert")} active={active}>
              {!accepted && (
                <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p>Booking opens once the customer accepts the quote.</p>
                  <button
                    type="button"
                    onClick={() => submit("accepted", "convert-step")}
                    disabled={isPending}
                    className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Customer Accepted
                  </button>
                </div>
              )}

              <div hidden={!accepted} className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <TextField name="job_number" label="Job # (required)" values={initial} />
                  <Field label="Job status">
                    <select name="job_status" defaultValue="Converted" className={inputCls}>
                      {JOB_STATUS_SUGGESTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Time converted (required)">
                    <input name="time_converted" type="datetime-local" defaultValue={timeConvertedDefault} className={inputCls} />
                  </Field>
                </div>

                {snapshot.job_status === PENDING_COMPLETION_STATUS && (
                  <Field label="Sub-status">
                    <select name="pending_completion_substatus" defaultValue="" className={inputCls}>
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

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Job amount (required)">
                    <input
                      name="job_amount"
                      type="number"
                      step="0.01"
                      value={jobAmount}
                      onChange={(e) => {
                        setJobAmountEdited(true);
                        setJobAmountValue(e.target.value);
                      }}
                      className={inputCls}
                    />
                  </Field>
                  <TextField name="quoted_service_amount" label="Vendor cost / provider quote" values={initial} type="number" step="0.01" />
                  <Field label="Estimated profit">
                    <div className="flex h-[34px] items-center rounded border border-black/10 bg-black/5 px-2 text-sm">
                      {estimatedProfit === null
                        ? "-"
                        : estimatedProfit.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <SelectField name="customer_charged_via" label="Payment method" values={initial} options={PLATFORMS} />
                  <SelectField
                    name="payment_authorization_status"
                    label="Payment authorization"
                    values={initial}
                    options={PAYMENT_AUTH_STATUSES}
                  />
                  <TextField name="preferred_vendor" label="Preferred vendor" values={initial} />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <TextField name="eta_minutes" label="ETA (minutes)" values={initial} type="number" step="1" />
                  <Field label="Schedule start">
                    <input name="schedule_start_at" type="datetime-local" className={inputCls} />
                  </Field>
                  <Field label="Schedule end">
                    <input name="schedule_end_at" type="datetime-local" className={inputCls} />
                  </Field>
                </div>

                <TextAreaField name="dispatch_notes" label="Dispatch notes" values={initial} rows={2} />

                <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-3">
                  <p className="text-xs text-black/50">
                    Everything collected on this call carries over to the job — vendors, invoices, and the rest of
                    dispatch are available on the job after converting.
                  </p>
                  <button
                    type="button"
                    onClick={handleConvert}
                    disabled={isPending}
                    className="shrink-0 rounded bg-green-700 px-6 py-2.5 text-sm font-bold tracking-wide text-white shadow disabled:opacity-50"
                  >
                    {isPending ? "CONVERTING..." : "CONVERT TO JOB"}
                  </button>
                </div>
              </div>
            </StepPanel>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          </IntakeShell>
        </form>
      </div>
    </div>
  );
}

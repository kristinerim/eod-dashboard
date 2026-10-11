"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEAM_MEMBERS, QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/constants";
import { INTAKE_STEPS, buildIntakeSummary, intakeInitialFromRecord, type IntakeStepId } from "@/lib/intake";
import { saveLead, startLeadConversion, type SaveLeadIntent } from "./lead-actions";
import JobForm, { type OpenLead } from "../reports/[id]/JobForm";
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
  CustomerStep,
  QuoteStep,
  inputCls,
} from "../intake/IntakePanels";

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
  // Set once the customer has accepted: the form hands over to Add Job.
  const [converting, setConverting] = useState<{ lead: OpenLead; reportId: string } | null>(null);

  const { formRef, snapshot, formHandlers } = useFormSnapshot({ ...initial, quote_status: quoteStatus });
  const jobType = snapshot.job_type ?? initial.job_type ?? "";

  const steps = INTAKE_STEPS;

  const summary = buildIntakeSummary({ ...snapshot, quote_status: quoteStatus }, "lead");

  const completed: Partial<Record<IntakeStepId, boolean>> = {
    service: !!snapshot.job_type,
    location: !!(snapshot.service_street_address || snapshot.service_city),
    vehicle: !!(snapshot.vehicle_make || snapshot.vehicle_model || snapshot.vehicle_year || snapshot.issue),
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

  // "Customer Accepted / Convert to Job": save the lead, then open Add Job with
  // everything collected so far already filled in. The job itself is created
  // when the agent saves that form.
  function handleConvert() {
    setError(null);
    setSavedNote(null);
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const text = (name: string) => String(formData.get(name) ?? "").trim();

    if (!text("agent")) return jump("service", "Select the agent for this lead.");
    if (!text("customer_name")) return jump("customer", "Enter the customer name before converting.");

    startTransition(async () => {
      const saved = await saveLead(leadId, formData, "accepted");
      if ("error" in saved) {
        setError(saved.error);
        return;
      }
      setLeadId(saved.id);
      setLeadNumber(saved.leadNumber);
      setQuoteStatus("accepted");

      const started = await startLeadConversion(saved.id);
      if ("error" in started) {
        setError(started.error);
        return;
      }
      if ("existing" in started) {
        // Already converted (a second click or another window): go to its job.
        router.push(`/reports/${started.existing.reportId}/jobs/${started.existing.jobId}`);
        return;
      }
      setConverting({ lead: started.lead as OpenLead, reportId: started.reportId });
    });
  }

  const stepDef = (id: IntakeStepId) => INTAKE_STEPS.find((s) => s.id === id)!;

  if (converting) {
    return (
      <JobForm
        reportId={converting.reportId}
        convertingFrom={converting.lead}
        onClose={onClose}
        agentOptions={agentOptions}
        currentRole={currentRole}
        currentAgentName={currentAgentName}
      />
    );
  }

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
              <VehicleStep values={initial} jobType={jobType} formRef={formRef} />
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
                    onClick={handleConvert}
                    disabled={isPending}
                    className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {isPending ? "Opening Add Job..." : "Customer Accepted / Convert to Job"}
                  </button>
                </div>
              </QuoteStep>
            </StepPanel>

            <StepPanel step={stepDef("convert")} active={active}>
              <div className="space-y-3">
                <p className="text-sm text-black/70">
                  When the customer accepts the quote, convert this lead. The lead is saved, and Add Job opens with
                  everything collected on this call already filled in — customer, service, locations, vehicle,
                  service details, distance, quote and notes. The job is created when you save it there, and this lead
                  is then marked Converted and linked to the job.
                </p>
                <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-3">
                  <p className="text-xs text-black/50">
                    If the customer doesn&apos;t go ahead, just save the lead — no job is created.
                  </p>
                  <button
                    type="button"
                    onClick={handleConvert}
                    disabled={isPending}
                    className="shrink-0 rounded bg-green-700 px-6 py-2.5 text-sm font-bold tracking-wide text-white shadow disabled:opacity-50"
                  >
                    {isPending ? "OPENING ADD JOB..." : "CUSTOMER ACCEPTED / CONVERT TO JOB"}
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

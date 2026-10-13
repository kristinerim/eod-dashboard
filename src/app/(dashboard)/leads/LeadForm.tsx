"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TEAM_MEMBERS, QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/constants";
import { INTAKE_STEPS, buildIntakeSummary, intakeInitialFromRecord, type IntakeStepId } from "@/lib/intake";
import { saveLead, createJobFromLead, type SaveLeadIntent } from "./lead-actions";
import { CONTACT_REQUIRED_MESSAGE, hasValidContact } from "@/lib/contact";
import JobForm from "../reports/[id]/JobForm";
import type { Job } from "../reports/[id]/JobsTable";
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
  // "Customer Proceed" asks first; once the job exists, the form hands over to it.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [converting, setConverting] = useState<{ job: Job; reportId: string; leadNumber: string } | null>(null);

  const { formRef, snapshot, formHandlers } = useFormSnapshot({ ...initial, quote_status: quoteStatus });
  const jobType = snapshot.job_type ?? initial.job_type ?? "";
  // Save Lead stays disabled until there is a valid phone or email.
  const canSave = hasValidContact(snapshot.customer_phone, snapshot.client_email);

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
    // Same rule the server enforces: a valid phone or email is needed to save.
    if (!hasValidContact(String(formData.get("customer_phone") ?? ""), String(formData.get("client_email") ?? ""))) {
      return jump("customer", CONTACT_REQUIRED_MESSAGE);
    }

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

  // "Customer Proceed": check the lead can become a job, then ask.
  function handleProceed() {
    setError(null);
    setSavedNote(null);
    const form = formRef.current;
    if (!form) return;
    const text = (name: string) => String(new FormData(form).get(name) ?? "").trim();
    if (!text("agent")) return jump("service", "Select the agent for this lead.");
    if (!text("customer_name")) return jump("customer", "Enter the customer name before creating a job.");
    setConfirmOpen(true);
  }

  // "Yes - Create Job": save the lead, create the job from it right now, and go
  // straight to Customer & Payment Information on that job.
  function createJob() {
    setError(null);
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);

    startTransition(async () => {
      const saved = await saveLead(leadId, formData, "accepted");
      if ("error" in saved) {
        setConfirmOpen(false);
        setError(saved.error);
        return;
      }
      setLeadId(saved.id);
      setLeadNumber(saved.leadNumber);
      setQuoteStatus("accepted");

      const created = await createJobFromLead(saved.id);
      if ("error" in created) {
        setConfirmOpen(false);
        setError(created.error);
        return;
      }
      if ("existing" in created) {
        // Already converted (a second click or another window): go to its job.
        router.push(`/reports/${created.existing.reportId}/jobs/${created.existing.jobId}`);
        return;
      }
      setConfirmOpen(false);
      setConverting({ job: created.job as unknown as Job, reportId: created.reportId, leadNumber: created.leadNumber });
    });
  }

  const stepDef = (id: IntakeStepId) => INTAKE_STEPS.find((s) => s.id === id)!;

  if (converting) {
    return (
      <JobForm
        reportId={converting.reportId}
        job={converting.job}
        createdFromLead={converting.leadNumber}
        startStep="customer"
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
                  disabled={isPending || !canSave}
                  title={canSave ? undefined : "Enter a valid customer phone number or email address to save"}
                  className="rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Save lead"}
                </button>
                {!canSave && (
                  <span className="self-center text-xs text-black/50">
                    Add a customer phone number or email to save
                  </span>
                )}
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
                    onClick={handleProceed}
                    disabled={isPending}
                    className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Customer Proceed
                  </button>
                </div>
              </QuoteStep>
            </StepPanel>

            <StepPanel step={stepDef("convert")} active={active}>
              <div className="space-y-3">
                <p className="text-sm text-black/70">
                  When the customer agrees to proceed, click Customer Proceed and confirm. The lead is saved and a Job
                  is created from it with everything collected on this call — customer, service, locations, vehicle,
                  service details, distance, quote and notes. You then go straight to Customer &amp; Payment
                  Information, and on to Dispatch &amp; Operations. This lead is marked Converted and linked to the
                  job.
                </p>
                <div className="flex items-center justify-between gap-3 border-t border-black/10 pt-3">
                  <p className="text-xs text-black/50">
                    If the customer doesn&apos;t go ahead, just save the lead — no job is created.
                  </p>
                  <button
                    type="button"
                    onClick={handleProceed}
                    disabled={isPending}
                    className="shrink-0 rounded bg-green-700 px-6 py-2.5 text-sm font-bold tracking-wide text-white shadow disabled:opacity-50"
                  >
                    CUSTOMER PROCEED
                  </button>
                </div>
              </div>
            </StepPanel>

            {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          </IntakeShell>
        </form>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md space-y-4 rounded-lg bg-white p-5 shadow-xl">
            <p className="text-base font-semibold">
              The customer has agreed to proceed. Would you like to create a Job?
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={isPending}
                className="rounded border border-black/20 px-4 py-2 text-sm disabled:opacity-50"
              >
                No – Stay on Lead
              </button>
              <button
                type="button"
                onClick={createJob}
                disabled={isPending}
                className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isPending ? "Creating Job..." : "Yes – Create Job"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useRef, useState } from "react";
import { JOB_TYPES, US_STATE_CODES } from "@/lib/constants";
import { JOB_DETAIL_FIELD_DEFS, type JobDetailFieldKey } from "@/lib/jobTypeFields";
import { jobTypeHasSecondDropOff, stepFieldKeys } from "@/lib/intake";
import { findCustomerByPhone, type CustomerMatch } from "./intake-actions";
import { setFieldValue } from "./useFormSnapshot";

export const inputCls = "w-full rounded border border-black/20 px-2 py-1.5 text-sm";

export type Values = Record<string, string>;

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className ?? ""}`}>
      <span className="text-xs font-medium text-black/60">{label}</span>
      {children}
    </label>
  );
}

export function TextField({
  name,
  label,
  values,
  type = "text",
  step,
  placeholder,
  maxLength,
  inputMode,
  className,
}: {
  name: string;
  label: string;
  values: Values;
  type?: string;
  step?: string;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "numeric" | "decimal" | "tel" | "email" | "text";
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <input
        name={name}
        type={type}
        step={step}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        defaultValue={values[name] ?? ""}
        className={inputCls}
      />
    </Field>
  );
}

export function SelectField({
  name,
  label,
  values,
  options,
  emptyLabel = "-",
  className,
}: {
  name: string;
  label: string;
  values: Values;
  options: readonly string[];
  emptyLabel?: string;
  className?: string;
}) {
  const current = values[name] ?? "";
  return (
    <Field label={label} className={className}>
      <select name={name} defaultValue={current} className={inputCls}>
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {current && !options.includes(current) && <option value={current}>{current}</option>}
      </select>
    </Field>
  );
}

export function TextAreaField({
  name,
  label,
  values,
  rows = 2,
  placeholder,
  className,
}: {
  name: string;
  label: string;
  values: Values;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <textarea name={name} rows={rows} placeholder={placeholder} defaultValue={values[name] ?? ""} className={inputCls} />
    </Field>
  );
}

function StateSelect({ name, label, values }: { name: string; label: string; values: Values }) {
  return <SelectField name={name} label={label} values={values} options={US_STATE_CODES} />;
}

// Year / Make / Model are asked as one question but stored as separate parts
// (and also as a composed string — see lib/intake.ts) so the dynamic Job Type
// config still treats it as the single "year_make_model" field.
function YearMakeModel({ values }: { values: Values }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <TextField name="vehicle_year" label="Year" values={values} maxLength={4} inputMode="numeric" placeholder="2018" />
      <TextField name="vehicle_make" label="Make" values={values} placeholder="Toyota" />
      <TextField name="vehicle_model" label="Model" values={values} placeholder="Camry" />
    </div>
  );
}

function DropOffAddress({ values, heading }: { values: Values; heading?: string }) {
  return (
    <div className="space-y-3">
      {heading && <div className="text-xs font-semibold text-black/70">{heading}</div>}
      <TextField name="dropoff_street_address" label="Drop-off address" values={values} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="dropoff_unit" label="Unit / suite" values={values} />
        <TextField name="dropoff_city" label="City" values={values} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StateSelect name="dropoff_state" label="State" values={values} />
        <TextField name="dropoff_zip" label="ZIP code" values={values} />
        <TextField name="dropoff_country" label="Country" values={{ ...values, dropoff_country: values.dropoff_country || "US" }} />
      </div>
      <TextAreaField
        name="dropoff_instructions"
        label="Additional drop-off instructions"
        values={values}
        placeholder="e.g. Drop at the shop's back lot — gate code 1234"
      />
    </div>
  );
}

function DynamicField({
  fieldKey,
  values,
  labelOverride,
}: {
  fieldKey: JobDetailFieldKey;
  values: Values;
  labelOverride?: string;
}) {
  const def = JOB_DETAIL_FIELD_DEFS[fieldKey];
  const label = labelOverride ?? def.label;

  if (fieldKey === "year_make_model") return <YearMakeModel values={values} />;
  if (fieldKey === "drop_off_location") return <DropOffAddress values={values} heading={labelOverride} />;
  if (def.kind === "note") return null;
  if (def.kind === "select") {
    return <SelectField name={fieldKey} label={label} values={values} options={def.options ?? []} />;
  }
  if (def.kind === "number") {
    return (
      <TextField
        name={fieldKey}
        label={fieldKey === "distance_miles" ? "Distance (miles)" : label}
        values={values}
        type="number"
        step="any"
      />
    );
  }
  if (def.kind === "textarea") return <TextAreaField name={fieldKey} label={label} values={values} className="col-span-2" />;
  return <TextField name={fieldKey} label={label} values={values} />;
}

function DynamicFieldGrid({ keys, values, jobType }: { keys: JobDetailFieldKey[]; values: Values; jobType: string }) {
  // Two-Way Tow is the only type with a second destination — when both are
  // present the first one reads "First Drop-Off Location" for clarity.
  const hasSecond = jobTypeHasSecondDropOff(jobType);
  const isFull = (k: JobDetailFieldKey) => k === "year_make_model" || k === "drop_off_location";
  const full = keys.filter(isFull);
  const rest = keys.filter((k) => !isFull(k));

  return (
    <div className="space-y-3">
      {full.map((k) => (
        <DynamicField
          key={k}
          fieldKey={k}
          values={values}
          labelOverride={k === "drop_off_location" && hasSecond ? "First drop-off" : undefined}
        />
      ))}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {rest.map((k) => (
            <DynamicField key={k} fieldKey={k} values={values} />
          ))}
        </div>
      )}
    </div>
  );
}

// 1. Service Type ---------------------------------------------------------

export function ServiceStep({ values }: { values: Values }) {
  return (
    <div className="space-y-2">
      <Field label="Job type / service requested">
        <select name="job_type" defaultValue={values.job_type ?? ""} className={inputCls}>
          <option value="">Select a service…</option>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {values.job_type && !JOB_TYPES.includes(values.job_type) && (
            <option value={values.job_type}>{values.job_type}</option>
          )}
        </select>
      </Field>
      <p className="text-xs text-black/50">
        The questions in the next steps adjust to the service you pick — towing asks for a drop-off, a jump start
        doesn&apos;t, and so on.
      </p>
    </div>
  );
}

// 2. Service Location -----------------------------------------------------

export function LocationStep({ values }: { values: Values }) {
  return (
    <div className="space-y-3">
      <TextField name="service_street_address" label="Street address" values={values} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="service_unit" label="Unit / suite" values={values} />
        <TextField name="service_city" label="City" values={values} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <StateSelect name="state" label="State" values={values} />
        <TextField name="service_zip" label="ZIP code" values={values} />
        <TextField name="service_country" label="Country" values={{ ...values, service_country: values.service_country || "US" }} />
      </div>
      <TextAreaField
        name="service_location_notes"
        label="Additional location details"
        values={values}
        placeholder="e.g. Vehicle is at the Walmart parking lot, near the main entrance."
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="service_latitude" label="Latitude" values={values} type="number" step="any" />
        <TextField name="service_longitude" label="Longitude" values={values} type="number" step="any" />
      </div>
      <button
        type="button"
        disabled
        title="Address autocomplete, map pin, and automatic GPS are coming once a maps provider is connected"
        className="w-full cursor-not-allowed rounded border border-dashed border-black/20 px-2 py-2 text-xs text-black/40"
      >
        Search address / pin on map (coming soon)
      </button>
    </div>
  );
}

// 3. Vehicle Information --------------------------------------------------

export function VehicleStep({ values, jobType }: { values: Values; jobType: string }) {
  return <DynamicFieldGrid keys={stepFieldKeys("vehicle", jobType)} values={values} jobType={jobType} />;
}

// 4. Service Details ------------------------------------------------------

export function DetailsStep({ values, jobType }: { values: Values; jobType: string }) {
  return <DynamicFieldGrid keys={stepFieldKeys("details", jobType)} values={values} jobType={jobType} />;
}

// 5. Drop-Off Location ----------------------------------------------------

export function DropOffStep({ values, jobType }: { values: Values; jobType: string }) {
  return (
    <div className="space-y-3">
      <DynamicFieldGrid keys={stepFieldKeys("dropoff", jobType)} values={values} jobType={jobType} />
      <p className="text-xs text-black/40">
        Distance is entered manually for now — it will calculate automatically from the pickup and drop-off once a
        maps provider is connected.
      </p>
    </div>
  );
}

// 6. Customer Information -------------------------------------------------

export function CustomerStep({
  values,
  formRef,
  excludeLeadId,
  children,
}: {
  values: Values;
  formRef: React.RefObject<HTMLFormElement | null>;
  excludeLeadId?: string;
  children?: React.ReactNode;
}) {
  const [match, setMatch] = useState<CustomerMatch | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const lastLooked = useRef("");

  async function lookup(phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits === lastLooked.current) return;
    lastLooked.current = digits;
    const result = await findCustomerByPhone(phone, excludeLeadId);
    if ("match" in result) {
      setMatch(result.match);
      setDismissed(false);
    }
  }

  function useMatch() {
    if (!match) return;
    const form = formRef.current;
    setFieldValue(form, "customer_name", match.customerName ?? "");
    setFieldValue(form, "client_company_name", match.company ?? "");
    setFieldValue(form, "phone_extension", match.extension ?? "");
    setFieldValue(form, "client_email", match.email ?? "");
    setDismissed(true);
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <TextField name="customer_name" label="Customer name" values={values} />
        <TextField name="client_company_name" label="Company name" values={values} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Phone number">
          <input
            name="customer_phone"
            inputMode="tel"
            defaultValue={values.customer_phone ?? ""}
            onChange={(e) => lookup(e.target.value)}
            onBlur={(e) => lookup(e.target.value)}
            className={inputCls}
          />
        </Field>
        <TextField name="phone_extension" label="Extension" values={values} />
        <TextField name="client_email" label="Email address" values={values} type="email" />
      </div>

      {match && !dismissed && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span>
            Existing customer found:{" "}
            <span className="font-medium">{match.customerName ?? "Unnamed"}</span>{" "}
            <span className="text-black/50">
              ({match.leadNumber} · {match.jobCount} previous job{match.jobCount === 1 ? "" : "s"})
            </span>
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={useMatch} className="rounded bg-black px-3 py-1 text-xs font-medium text-white">
              Use this customer&apos;s info
            </button>
            <button type="button" onClick={() => setDismissed(true)} className="rounded border border-black/20 px-3 py-1 text-xs">
              Not them
            </button>
          </span>
        </div>
      )}

      <TextField
        name="caller_id"
        label="Caller ID (incoming number)"
        values={values}
        placeholder="Enter the incoming number if different from the phone above"
      />

      {children}
    </div>
  );
}

// 7. Pricing and Quote ----------------------------------------------------

function num(v: string | undefined): number {
  return Number(v) || 0;
}

export function QuoteStep({
  values,
  snapshot,
  mode,
  children,
}: {
  values: Values;
  snapshot: Values;
  mode: "lead" | "job";
  children?: React.ReactNode;
}) {
  const total =
    mode === "lead" ? num(snapshot.quoted_price) + num(snapshot.additional_charges) : num(snapshot.job_amount);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {mode === "lead" ? (
          <TextField name="quoted_price" label="Customer quoted price" values={values} type="number" step="0.01" />
        ) : (
          <TextField
            name="job_amount"
            label="Customer price / job amount (required)"
            values={values}
            type="number"
            step="0.01"
          />
        )}
        <TextField
          name="additional_charges"
          label={mode === "lead" ? "Additional charges" : "Additional charges (included above)"}
          values={values}
          type="number"
          step="0.01"
        />
        <Field label={mode === "lead" ? "Total quote" : "Total charged"}>
          <div className="flex h-[34px] items-center rounded border border-black/10 bg-black/5 px-2 text-sm font-medium">
            {total.toLocaleString("en-US", { style: "currency", currency: "USD" })}
          </div>
        </Field>
      </div>
      <TextAreaField name="quote_notes" label="Quote notes" values={values} rows={3} />
      {children}
    </div>
  );
}

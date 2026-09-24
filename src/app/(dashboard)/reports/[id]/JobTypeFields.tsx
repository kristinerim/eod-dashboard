import { JOB_TYPE_FIELD_KEYS, JOB_DETAIL_FIELD_DEFS, type JobDetailFieldKey } from "@/lib/jobTypeFields";
import type { Job } from "./JobsTable";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-black/60">{label}</span>
      {children}
    </label>
  );
}

export default function JobTypeFields({ jobType, job }: { jobType: string; job?: Job }) {
  const keys = JOB_TYPE_FIELD_KEYS[jobType] ?? [];
  if (keys.length === 0) return null;

  // Two-Way Tow is the only type with a second destination — when both are
  // present, the first one reads "First Drop-Off Location" for clarity.
  const hasSecondDropOff = keys.includes("second_drop_off_location");

  return (
    <div className="space-y-3 rounded border border-black/10 bg-black/[0.02] p-3">
      <div className="grid grid-cols-2 gap-3">
        {keys.map((key) => (
          <JobTypeField key={key} fieldKey={key} job={job} labelOverride={key === "drop_off_location" && hasSecondDropOff ? "First Drop-Off Location" : undefined} />
        ))}
      </div>
    </div>
  );
}

function JobTypeField({
  fieldKey,
  job,
  labelOverride,
}: {
  fieldKey: JobDetailFieldKey;
  job?: Job;
  labelOverride?: string;
}) {
  const def = JOB_DETAIL_FIELD_DEFS[fieldKey];
  const label = labelOverride ?? def.label;

  if (def.kind === "note") {
    return (
      <div className="col-span-2">
        <span className="text-xs font-medium text-black/60">{label}</span>
        <p className="text-xs text-black/50">Same as the Service Location entered above.</p>
      </div>
    );
  }

  const value = (job?.[fieldKey as keyof Job] as string | number | null | undefined) ?? "";

  if (def.kind === "select") {
    return (
      <Field label={label}>
        <select
          name={fieldKey}
          defaultValue={value}
          className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
        >
          <option value="">-</option>
          {def.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (def.kind === "number") {
    return (
      <Field label={label}>
        <input
          name={fieldKey}
          type="number"
          step="any"
          defaultValue={value}
          className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
        />
        {fieldKey === "distance_miles" && (
          <p className="text-xs text-black/40">Will be calculated automatically once route mapping is added.</p>
        )}
      </Field>
    );
  }

  return (
    <Field label={label}>
      <input
        name={fieldKey}
        defaultValue={value}
        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
      />
    </Field>
  );
}

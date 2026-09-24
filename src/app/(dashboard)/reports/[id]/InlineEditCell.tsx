"use client";

import { useRef, useState, useTransition } from "react";
import { updateJobQuickField } from "./jobs/[jobId]/actions";

type QuickEditField =
  | "last4_vpc"
  | "call_que"
  | "brex_check"
  | "slash_check"
  | "wc_entered_by_jon"
  | "final_checked_by_zumi";

const baseClass =
  "w-full min-w-[6rem] rounded border bg-transparent px-1.5 py-1 text-sm focus:bg-white";

// Any signed-in team member can edit these — they're back-office
// verification checks (e.g. Jon/Zumi reviewing every job), not something
// limited to the job's own agent — matching updateJobQuickField's own
// permission check (any signed-in user, any day).
export function InlineTextCell({
  jobId,
  reportId,
  field,
  initialValue,
}: {
  jobId: string;
  reportId: string;
  field: QuickEditField;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const savedValue = useRef(initialValue ?? "");

  function save() {
    if (value === savedValue.current) return;
    setError(null);
    startTransition(async () => {
      const result = await updateJobQuickField(jobId, reportId, field, value);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      savedValue.current = value;
    });
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
      }}
      onBlur={save}
      disabled={isPending}
      title={error ?? undefined}
      className={`${baseClass} ${error ? "border-red-400" : "border-transparent hover:border-black/20 focus:border-black/40"}`}
    />
  );
}

export function InlineSelectCell({
  jobId,
  reportId,
  field,
  options,
  initialValue,
}: {
  jobId: string;
  reportId: string;
  field: QuickEditField;
  options: string[];
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    setValue(v);
    setError(null);
    startTransition(async () => {
      const result = await updateJobQuickField(jobId, reportId, field, v);
      if ("error" in result) setError(result.error);
    });
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={isPending}
      title={error ?? undefined}
      className={`${baseClass} ${error ? "border-red-400" : "border-transparent hover:border-black/20 focus:border-black/40"}`}
    >
      <option value="">-</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

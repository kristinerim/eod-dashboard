"use client";

import type { IntakeStepDef, IntakeStepId } from "@/lib/intake";

// The frame shared by Create Lead, Create Job, and their edit modes: a step
// strip across the top, the active step in the middle, and an always-visible
// summary beside it. Every step's panel stays mounted (see StepPanel) so
// moving between sections never loses anything the agent already entered.
export default function IntakeShell({
  steps,
  active,
  onSelect,
  summary,
  completed,
  children,
  footer,
}: {
  steps: IntakeStepDef[];
  active: IntakeStepId;
  onSelect: (id: IntakeStepId) => void;
  summary: { label: string; value: string }[];
  completed?: Partial<Record<IntakeStepId, boolean>>;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const index = steps.findIndex((s) => s.id === active);
  const prev = index > 0 ? steps[index - 1] : null;
  const next = index >= 0 && index < steps.length - 1 ? steps[index + 1] : null;

  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap gap-1.5" aria-label="Workflow steps">
        {steps.map((s, i) => {
          const isActive = s.id === active;
          const isDone = completed?.[s.id];
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={isActive ? "step" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                isActive
                  ? "border-black bg-black text-white"
                  : isDone
                    ? "border-green-300 bg-green-50 text-green-800"
                    : "border-black/20 text-black/70 hover:bg-black/5"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  isActive ? "bg-white text-black" : isDone ? "bg-green-600 text-white" : "bg-black/10"
                }`}
              >
                {isDone && !isActive ? "✓" : i + 1}
              </span>
              {s.title}
            </button>
          );
        })}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
        <div className="min-w-0 space-y-3">
          {children}

          <div className="flex items-center justify-between gap-2 border-t border-black/10 pt-3">
            <div className="flex gap-2">
              {prev && (
                <button
                  type="button"
                  onClick={() => onSelect(prev.id)}
                  className="rounded border border-black/20 px-3 py-1.5 text-sm"
                >
                  ← {prev.title}
                </button>
              )}
              {next && (
                <button
                  type="button"
                  onClick={() => onSelect(next.id)}
                  className="rounded border border-black/20 px-3 py-1.5 text-sm font-medium"
                >
                  {next.title} →
                </button>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">{footer}</div>
          </div>
        </div>

        <aside className="order-first lg:order-last">
          <div className="rounded-lg border border-black/10 bg-black/[0.03] p-3 lg:sticky lg:top-0">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/50">
              Current summary
            </div>
            <dl className="space-y-1.5 text-sm">
              {summary.map((row) => (
                <div key={row.label}>
                  <dt className="text-[11px] text-black/50">{row.label}</dt>
                  <dd className={row.value === "—" ? "text-black/30" : "font-medium"}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

// Hidden rather than unmounted when inactive, so uncontrolled inputs keep
// their values and still submit with the form.
export function StepPanel({
  step,
  active,
  children,
}: {
  step: IntakeStepDef;
  active: IntakeStepId;
  children: React.ReactNode;
}) {
  return (
    <section hidden={step.id !== active} className="space-y-3 rounded-lg border border-black/10 p-3">
      <header>
        <h3 className="text-sm font-semibold text-black/80">{step.title}</h3>
        <p className="text-xs italic text-black/50">&ldquo;{step.prompt}&rdquo;</p>
      </header>
      {children}
    </section>
  );
}

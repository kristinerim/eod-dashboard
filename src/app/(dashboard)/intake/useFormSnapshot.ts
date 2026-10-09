"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The guided workflow keeps every step mounted (just hidden) so nothing a
// customer said is lost when the agent jumps between sections. That means the
// inputs stay uncontrolled and FormData remains the source of truth — this
// hook mirrors it into state so the live summary panel and the job-type-driven
// field visibility can react to what's been typed.
export function useFormSnapshot(initial: Record<string, string>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [snapshot, setSnapshot] = useState<Record<string, string>>(initial);

  const sync = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const next: Record<string, string> = {};
    new FormData(form).forEach((v, k) => {
      if (typeof v === "string") next[k] = v;
    });
    setSnapshot((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  // Only onChange — never onInput. A dropdown fires the native "input" event
  // before "change"; re-rendering in between made React reset any controlled
  // <select> (Job status, Vendor paid via) to its old value before it could
  // record the choice. React's onChange already fires for typing in text
  // fields, so nothing is lost.
  return { formRef, snapshot, sync, formHandlers: { onChange: sync } };
}

// Programmatically fills an uncontrolled field and lets the snapshot hear
// about it (used when a phone-number match auto-populates customer details).
export function setFieldValue(form: HTMLFormElement | null, name: string, value: string) {
  if (!form) return;
  const el = form.elements.namedItem(name);
  if (!el || el instanceof RadioNodeList) return;
  const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

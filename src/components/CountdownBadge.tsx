"use client";

import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const sign = ms < 0 ? "Overdue by " : "";
  return `${sign}${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function useCountdown(deadline: number | null) {
  // Start null so server render and initial client render match exactly
  // (Date.now() differs between the two, which would otherwise cause a
  // hydration mismatch); the real value is filled in after mount.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return deadline === null || now === null ? null : deadline - now;
}

export default function CountdownBadge({ deadline }: { deadline: number | null }) {
  const remaining = useCountdown(deadline);

  if (deadline === null) {
    return (
      <span className="inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/40">
        No ETA
      </span>
    );
  }

  if (remaining === null) {
    return (
      <span className="inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/40">
        …
      </span>
    );
  }

  const overdue = remaining < 0;
  const soon = !overdue && remaining < 5 * 60 * 1000;

  return (
    <span
      className={
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium " +
        (overdue
          ? "bg-red-100 text-red-700"
          : soon
            ? "bg-amber-100 text-amber-700"
            : "bg-green-100 text-green-700")
      }
    >
      {formatRemaining(remaining)}
    </span>
  );
}

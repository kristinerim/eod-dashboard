"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clockIn, clockOut } from "./actions";

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export default function ClockWidget({
  openEntry,
}: {
  openEntry: { id: string; clock_in: string } | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!openEntry) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [openEntry]);

  function handleClockIn() {
    setError(null);
    startTransition(async () => {
      const result = await clockIn();
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleClockOut() {
    if (!openEntry) return;
    setError(null);
    startTransition(async () => {
      const result = await clockOut(openEntry.id);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  const elapsed =
    openEntry && now !== null ? formatElapsed(now - new Date(openEntry.clock_in).getTime()) : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-black/10 p-4">
      {openEntry ? (
        <>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Clocked in
          </span>
          <span className="text-sm text-black/60">{elapsed ?? "…"} so far</span>
          <button
            onClick={handleClockOut}
            disabled={isPending}
            className="ml-auto rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Clock out
          </button>
        </>
      ) : (
        <>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/50">
            Clocked out
          </span>
          <button
            onClick={handleClockIn}
            disabled={isPending}
            className="ml-auto rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Clock in
          </button>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

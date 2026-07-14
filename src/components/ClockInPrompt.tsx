"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { clockIn } from "@/app/(dashboard)/hours/actions";

export default function ClockInPrompt({ hasOpenEntry }: { hasOpenEntry: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (hasOpenEntry || dismissed || pathname?.startsWith("/hours")) return null;

  function handleClockIn() {
    setError(null);
    startTransition(async () => {
      const result = await clockIn();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setDismissed(true);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Clock in?</h2>
        <p className="mt-1 text-sm text-black/60">
          You&apos;re not clocked in yet. Clock in now to start tracking your hours.
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setDismissed(true)}
            type="button"
            className="rounded border border-black/20 px-4 py-1.5 text-sm"
          >
            Not now
          </button>
          <button
            onClick={handleClockIn}
            disabled={isPending}
            type="button"
            className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? "Clocking in..." : "Clock in"}
          </button>
        </div>
      </div>
    </div>
  );
}

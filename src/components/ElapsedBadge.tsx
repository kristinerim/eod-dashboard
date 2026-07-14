"use client";

import { useEffect, useState } from "react";

function formatElapsed(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export default function ElapsedBadge({ since }: { since: string }) {
  // Start null so server render and initial client render match exactly
  // (Date.now() differs between the two, which would otherwise cause a
  // hydration mismatch); the real value is filled in after mount.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (now === null) {
    return (
      <span className="inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/40">
        …
      </span>
    );
  }

  const elapsed = now - new Date(since).getTime();
  const hours = elapsed / 3600000;
  const level = hours >= 4 ? "bg-red-100 text-red-700" : hours >= 1 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${level}`}>
      {formatElapsed(elapsed)}
    </span>
  );
}

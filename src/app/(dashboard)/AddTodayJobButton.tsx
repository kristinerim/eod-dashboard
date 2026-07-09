"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateTodaysReport } from "./reports/[id]/job-actions";

export default function AddTodayJobButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await getOrCreateTodaysReport();
      if ("error" in result) {
        alert(result.error);
        return;
      }
      router.push(`/reports/${result.id}`);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      type="button"
      className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
    >
      {isPending ? "Loading..." : "+ Add job"}
    </button>
  );
}

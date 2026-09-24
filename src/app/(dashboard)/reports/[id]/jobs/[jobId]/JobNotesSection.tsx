"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addJobNote } from "./actions";

export interface JobNote {
  id: string;
  note: string;
  author: string | null;
  created_at: string;
}

function formatDateTime(d: string) {
  // Matches the requested "MM/DD/YYYY – h:mm AM/PM" format, in PHT like
  // every other timestamp on this page.
  const parts = new Date(d).toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const [datePart, timePart] = parts.split(", ");
  return `${datePart} – ${timePart}`;
}

export default function JobNotesSection({
  jobId,
  reportId,
  notes,
}: {
  jobId: string;
  reportId: string;
  notes: JobNote[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = textareaRef.current?.value ?? "";
    setError(null);
    startTransition(async () => {
      const result = await addJobNote(jobId, reportId, note);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (textareaRef.current) textareaRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold">Notes / Updates</h2>
      <div className="space-y-3 rounded-lg border border-black/10 p-4">
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea
            ref={textareaRef}
            rows={2}
            placeholder="Add an update..."
            className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
          />
          <div className="flex items-center justify-between">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={isPending}
              className="ml-auto rounded bg-black px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Add update"}
            </button>
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="text-sm text-black/50">No updates yet.</p>
        ) : (
          <div className="space-y-3 border-t border-black/10 pt-3">
            {notes.map((n) => (
              <div key={n.id} className="text-sm">
                <div className="font-medium text-black/70">
                  {formatDateTime(n.created_at)} | {n.author ?? "Unknown"}
                </div>
                <div className="whitespace-pre-wrap text-black/90">{n.note}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

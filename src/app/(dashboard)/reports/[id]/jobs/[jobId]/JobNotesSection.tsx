"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addJobNote, voidJobNote, deleteJobNotePermanently } from "./actions";

export interface JobNote {
  id: string;
  note: string;
  author: string | null;
  created_at: string;
  created_by: string | null;
  voided_at: string | null;
  voided_by_name: string | null;
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
  currentUserId,
  isFullAdmin,
}: {
  jobId: string;
  reportId: string;
  notes: JobNote[];
  currentUserId: string | null;
  isFullAdmin: boolean;
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

  function handleVoid(noteId: string) {
    setError(null);
    startTransition(async () => {
      const result = await voidJobNote(noteId, jobId, reportId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(noteId: string) {
    if (!confirm("Are you sure you want to permanently delete this update?")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteJobNotePermanently(noteId, jobId, reportId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
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
            {notes.map((n) => {
              const isVoided = !!n.voided_at;
              const canVoid = !isVoided && (n.created_by === currentUserId || isFullAdmin);
              return (
                <div key={n.id} className="text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className={`font-medium text-black/70 ${isVoided ? "line-through" : ""}`}>
                        {formatDateTime(n.created_at)} | {n.author ?? "Unknown"}
                      </div>
                      <div className={`whitespace-pre-wrap text-black/90 ${isVoided ? "line-through" : ""}`}>
                        {n.note}
                      </div>
                      {isVoided && (
                        <div className="text-xs text-black/50">
                          Voided: {formatDateTime(n.voided_at!)} | {n.voided_by_name ?? "Unknown"}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {canVoid && (
                        <button
                          type="button"
                          onClick={() => handleVoid(n.id)}
                          disabled={isPending}
                          className="text-xs text-black/50 hover:text-black hover:underline disabled:opacity-50"
                        >
                          Void
                        </button>
                      )}
                      {isFullAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDelete(n.id)}
                          disabled={isPending}
                          className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

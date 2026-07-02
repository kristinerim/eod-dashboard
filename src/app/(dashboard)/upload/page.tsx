"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UploadResult {
  reportDate: string;
  jobCount: number;
}

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setStatus("uploading");
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      setStatus("error");
      setError(data.error ?? "Upload failed.");
      return;
    }

    setResults(data.results ?? []);
    setStatus("done");
    router.refresh();
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-lg font-semibold">Upload EOD report</h1>
      <p className="text-sm text-black/60">
        Upload the EOD report Excel file. A single file can contain multiple days&apos;
        reports — each will be saved separately. Re-uploading a report for a date
        already on file replaces that day&apos;s data.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm"
        />
        <button
          type="submit"
          disabled={!file || status === "uploading"}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {status === "uploading" ? "Uploading..." : "Upload"}
        </button>
      </form>

      {status === "error" && <p className="text-sm text-red-600">{error}</p>}

      {status === "done" && (
        <div className="rounded border border-black/10 p-3 text-sm">
          <p className="font-medium">Saved:</p>
          <ul className="mt-1 list-disc pl-5">
            {results.map((r) => (
              <li key={r.reportDate}>
                {r.reportDate} — {r.jobCount} jobs
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

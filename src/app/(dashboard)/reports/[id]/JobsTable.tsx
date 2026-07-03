"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import JobForm from "./JobForm";
import { deleteJob } from "./job-actions";

export interface Job {
  id: string;
  row_number: number | null;
  agent: string | null;
  dispatcher: string | null;
  job_number: string | null;
  job_amount: number | null;
  vendors_fee: number | null;
  refunded_to_client: number | null;
  profit: number | null;
  customer_charged_via: string | null;
  vendor_paid_via: string | null;
  vendor_name: string | null;
  last4_vpc: string | null;
  job_status: string | null;
  eta_minutes: number | null;
  dispatched_at: string | null;
  dispatched_time: string | null;
  vendor_eta: string | null;
  reviewed_by: string | null;
  state: string | null;
  customer_phone: string | null;
  call_que: string | null;
  brex_check: string | null;
  slash_check: string | null;
  wc_entered_by_jon: string | null;
  final_checked_by_zumi: string | null;
  notes: string | null;
}

type Column = {
  key: keyof Job;
  label: string;
  currency?: boolean;
};

const COLUMNS: Column[] = [
  { key: "row_number", label: "#" },
  { key: "agent", label: "Agent" },
  { key: "dispatcher", label: "Dispatcher" },
  { key: "job_number", label: "Job #" },
  { key: "job_amount", label: "Job amount", currency: true },
  { key: "vendors_fee", label: "Vendor fee", currency: true },
  { key: "refunded_to_client", label: "Refunded", currency: true },
  { key: "profit", label: "Profit", currency: true },
  { key: "vendor_name", label: "Vendor" },
  { key: "job_status", label: "Status" },
  { key: "eta_minutes", label: "ETA (min)" },
  { key: "state", label: "State" },
  { key: "customer_phone", label: "Customer phone" },
  { key: "customer_charged_via", label: "Charged via" },
  { key: "vendor_paid_via", label: "Paid via" },
  { key: "reviewed_by", label: "Reviewed by (ETA min)" },
  { key: "dispatched_time", label: "Dispatched / appt notes" },
  { key: "notes", label: "Notes" },
];

const SEARCH_FIELDS: (keyof Job)[] = [
  "agent",
  "dispatcher",
  "job_number",
  "vendor_name",
  "notes",
  "customer_phone",
];

function formatCurrency(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function JobsTable({
  jobs,
  reportId,
  isToday = false,
}: {
  jobs: Job[];
  reportId: string;
  isToday?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sortKey, setSortKey] = useState<keyof Job>("row_number");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [addingJob, setAddingJob] = useState(false);

  function handleDelete(jobId: string) {
    if (!confirm("Delete this job entry?")) return;
    startTransition(async () => {
      const result = await deleteJob(jobId);
      if ("error" in result) {
        alert(result.error);
        return;
      }
      router.refresh();
    });
  }

  const statuses = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.job_status).filter(Boolean))).sort(),
    [jobs]
  );
  const states = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.state).filter(Boolean))).sort(),
    [jobs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter && j.job_status !== statusFilter) return false;
      if (stateFilter && j.state !== stateFilter) return false;
      if (!q) return true;
      return SEARCH_FIELDS.some((f) => String(j[f] ?? "").toLowerCase().includes(q));
    });
  }, [jobs, search, statusFilter, stateFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: keyof Job) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agent, job #, vendor, phone, notes..."
          className="w-64 rounded border border-black/20 px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-black/20 px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s!}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded border border-black/20 px-2 py-1.5 text-sm"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s!}>
              {s}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-black/50">
          {sorted.length} of {jobs.length}
        </span>
        {isToday && (
          <button
            onClick={() => setAddingJob(true)}
            className="ml-auto rounded bg-black px-3 py-1.5 text-sm font-medium text-white"
            type="button"
          >
            + Add job
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="cursor-pointer whitespace-nowrap px-3 py-2 font-medium hover:bg-black/10"
                >
                  {c.label}
                  {sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
              {isToday && <th className="whitespace-nowrap px-3 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((j) => (
              <tr key={j.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                {COLUMNS.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2">
                    {c.currency
                      ? formatCurrency(j[c.key] as number | null)
                      : (j[c.key] as string | number | null) ?? "-"}
                  </td>
                ))}
                {isToday && (
                  <td className="whitespace-nowrap px-3 py-2">
                    <button
                      onClick={() => setEditingJob(j)}
                      className="mr-2 text-black/60 hover:text-black hover:underline"
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(j.id)}
                      disabled={isPending}
                      className="text-red-600 hover:underline disabled:opacity-50"
                      type="button"
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addingJob && <JobForm reportId={reportId} onClose={() => setAddingJob(false)} />}
      {editingJob && (
        <JobForm reportId={reportId} job={editingJob} onClose={() => setEditingJob(null)} />
      )}
    </div>
  );
}

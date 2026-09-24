"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import JobForm, { type OpenLead } from "./JobForm";
import { deleteJob } from "./job-actions";
import { needsRefund } from "@/lib/aggregate";
import type { ContactedVendorRow } from "./job-fields";
import { InlineTextCell, InlineSelectCell } from "./InlineEditCell";
import { FINAL_CHECK_OPTIONS } from "@/lib/constants";

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
  pending_completion_substatus: string | null;
  cancellation_reason: string | null;
  eta_minutes: number | null;
  appointment_at: string | null;
  time_converted: string | null;
  time_dispatched: string | null;
  dispatched_time: string | null;
  vendor_eta: string | null;
  reviewed_by: string | null;
  state: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  call_que: string | null;
  brex_check: string | null;
  slash_check: string | null;
  wc_entered_by_jon: string | null;
  final_checked_by_zumi: string | null;
  notes: string | null;
  client_company_name: string | null;
  client_email: string | null;
  phone_extension: string | null;
  service_street_address: string | null;
  service_unit: string | null;
  service_city: string | null;
  service_zip: string | null;
  service_country: string | null;
  service_latitude: number | null;
  service_longitude: number | null;
  job_name: string | null;
  job_type: string | null;
  schedule_start_at: string | null;
  schedule_end_at: string | null;
  is_all_day: boolean | null;
  quoted_service_amount: number | null;
  goa: boolean | null;
  tl_quote: number | null;
  tl_eta_minutes: number | null;
  quoted_by_dispatcher: string | null;
  card_expiry: string | null;
  billing_address: string | null;
  year_make_model: string | null;
  vin_or_lpn: string | null;
  color: string | null;
  issue: string | null;
  can_go_to_neutral: string | null;
  tire_condition: string | null;
  drivetrain: string | null;
  drop_off_location: string | null;
  second_drop_off_location: string | null;
  distance_miles: number | null;
  customer_card_last4: string | null;
  customer_billing_address: string | null;
  with_good_spare_tire: string | null;
  locking_lug_nut: string | null;
  number_of_gallons: number | null;
  fuel_type: string | null;
  tire_size: string | null;
}

type Column = {
  key: keyof Job;
  label: string;
  currency?: boolean;
  datetime?: boolean;
  quickEdit?: "text" | "select";
};

const COLUMNS: Column[] = [
  { key: "row_number", label: "#" },
  { key: "agent", label: "Agent" },
  { key: "dispatcher", label: "Dispatcher" },
  { key: "job_number", label: "Job #" },
  { key: "job_name", label: "Job name" },
  { key: "job_type", label: "Job type" },
  { key: "job_amount", label: "Job amount", currency: true },
  { key: "vendors_fee", label: "Vendor fee", currency: true },
  { key: "refunded_to_client", label: "Refunded", currency: true },
  { key: "profit", label: "Profit", currency: true },
  { key: "vendor_name", label: "Vendor" },
  { key: "job_status", label: "Status" },
  { key: "pending_completion_substatus", label: "Sub-status" },
  { key: "eta_minutes", label: "ETA (min)" },
  { key: "appointment_at", label: "Appointment date/time", datetime: true },
  { key: "time_converted", label: "Time converted", datetime: true },
  { key: "time_dispatched", label: "Time dispatched", datetime: true },
  { key: "state", label: "State" },
  { key: "customer_name", label: "Customer name" },
  { key: "customer_phone", label: "Customer phone" },
  { key: "customer_charged_via", label: "Customer charged via" },
  { key: "vendor_paid_via", label: "Vendor paid via" },
  { key: "reviewed_by", label: "Reviewed by" },
  { key: "last4_vpc", label: "Last 4 of VPC", quickEdit: "text" },
  { key: "call_que", label: "Call Queue", quickEdit: "text" },
  { key: "brex_check", label: "Brex Check", quickEdit: "text" },
  { key: "slash_check", label: "Slash Check", quickEdit: "text" },
  { key: "wc_entered_by_jon", label: "WC (Entered by Jon)", quickEdit: "text" },
  { key: "final_checked_by_zumi", label: "Final Checked by Zumi", quickEdit: "select" },
  { key: "dispatched_time", label: "Dispatched / appt notes" },
  { key: "notes", label: "Notes" },
];

const SEARCH_FIELDS: (keyof Job)[] = [
  "agent",
  "dispatcher",
  "job_number",
  "vendor_name",
  "notes",
  "customer_name",
  "customer_phone",
];

function formatCurrency(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

// Matches the "MM/DD/YYYY – h:mm AM/PM" format used in the job's own Notes /
// Updates history, so the dashboard preview reads the same way.
function formatNoteTimestamp(d: string) {
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

/** Appointments with no vendor yet need dispatcher attention. */
function needsVendor(j: Job): boolean {
  return j.job_status?.trim().toLowerCase() === "appointment" && !j.vendor_name;
}


export default function JobsTable({
  jobs,
  reportId,
  isToday = false,
  canDelete = false,
  agentOptions,
  currentRole,
  currentAgentName,
  openLeads,
  contactedVendorsByJobId,
  latestNoteByJobId,
}: {
  jobs: Job[];
  reportId: string;
  isToday?: boolean;
  canDelete?: boolean;
  agentOptions?: string[];
  currentRole?: string;
  currentAgentName?: string | null;
  openLeads?: OpenLead[];
  contactedVendorsByJobId?: Record<string, (ContactedVendorRow & { id: string })[]>;
  latestNoteByJobId?: Record<string, { note: string; author: string | null; created_at: string }>;
}) {
  const canEditJob = (job: Job) =>
    currentRole !== "agent" || job.agent === currentAgentName;
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
              <th className="sticky left-0 z-10 whitespace-nowrap bg-black/5 px-3 py-2 font-medium">
                Actions
              </th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Latest Note</th>
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((j) => (
              <tr
                key={j.id}
                className={`group border-t border-black/10 hover:bg-black/[0.03] ${
                  needsVendor(j) || needsRefund(j) ? "text-red-600" : ""
                }`}
              >
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 group-hover:bg-black/[0.03]">
                  <Link
                    href={`/reports/${reportId}/jobs/${j.id}`}
                    target="_blank"
                    className="mr-2 text-black/60 hover:text-black hover:underline"
                  >
                    View
                  </Link>
                  {canEditJob(j) && (
                    <button
                      onClick={() => setEditingJob(j)}
                      className="mr-2 text-black/60 hover:text-black hover:underline"
                      type="button"
                    >
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(j.id)}
                      disabled={isPending}
                      className="text-red-600 hover:underline disabled:opacity-50"
                      type="button"
                    >
                      Delete
                    </button>
                  )}
                </td>
                <td className="max-w-[220px] px-3 py-2">
                  {latestNoteByJobId?.[j.id] ? (
                    <div title={latestNoteByJobId[j.id].note}>
                      <div className="whitespace-nowrap text-xs text-black/50">
                        {formatNoteTimestamp(latestNoteByJobId[j.id].created_at)} | {latestNoteByJobId[j.id].author ?? "Unknown"}
                      </div>
                      <div className="truncate">{latestNoteByJobId[j.id].note}</div>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    className={c.quickEdit ? "px-1 py-1" : "whitespace-nowrap px-3 py-2"}
                  >
                    {c.key === "vendor_name" && needsVendor(j) ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        NO VENDOR - ACTION NEEDED
                      </span>
                    ) : c.quickEdit === "text" ? (
                      <InlineTextCell
                        jobId={j.id}
                        reportId={reportId}
                        field={c.key as "last4_vpc" | "call_que" | "brex_check" | "slash_check" | "wc_entered_by_jon"}
                        initialValue={j[c.key] as string | null}
                      />
                    ) : c.quickEdit === "select" ? (
                      <InlineSelectCell
                        jobId={j.id}
                        reportId={reportId}
                        field="final_checked_by_zumi"
                        options={FINAL_CHECK_OPTIONS}
                        initialValue={j[c.key] as string | null}
                      />
                    ) : c.currency ? (
                      formatCurrency(j[c.key] as number | null)
                    ) : c.datetime ? (
                      formatDateTime(j[c.key] as string | null)
                    ) : (
                      ((j[c.key] as string | number | null) ?? "-")
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addingJob && (
        <JobForm
          reportId={reportId}
          onClose={() => setAddingJob(false)}
          agentOptions={agentOptions}
          currentRole={currentRole}
          currentAgentName={currentAgentName}
          openLeads={openLeads}
        />
      )}
      {editingJob && (
        <JobForm
          reportId={reportId}
          job={editingJob}
          onClose={() => setEditingJob(null)}
          agentOptions={agentOptions}
          currentRole={currentRole}
          currentAgentName={currentAgentName}
          contactedVendors={contactedVendorsByJobId?.[editingJob.id]}
        />
      )}
    </div>
  );
}

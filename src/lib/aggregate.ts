export interface JobSummaryInput {
  profit: number | null;
  job_amount: number | null;
  vendors_fee: number | null;
  job_status: string | null;
  customer_charged_via: string | null;
}

export interface JobSummary {
  totalProfit: number;
  totalJobAmount: number;
  totalVendorFee: number;
  jobCount: number;
  statusBreakdown: { status: string; count: number }[];
  platformBreakdown: { platform: string; count: number; amount: number }[];
}

function isCancelled(status: string | null): boolean {
  return status?.trim().toLowerCase() === "cancelled";
}

/** A job stays "open" (still needs tracking) until it's Completed or Cancelled. */
export function isOpenJobStatus(status: string | null): boolean {
  const s = status?.trim().toLowerCase();
  return s !== "completed" && s !== "cancelled";
}

export function isCompletedStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "completed";
}

export function isDispatchedStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "dispatched";
}

export function isPendingCompletionStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "service rendered – pending completion";
}

/** Jobs an agent is currently working: dispatched, in progress, or on hold. */
export function isActiveJobStatus(status: string | null): boolean {
  const s = status?.trim().toLowerCase();
  return s === "dispatched" || s === "in progress" || s === "on hold";
}

export function summarizeJobs(jobs: JobSummaryInput[]): JobSummary {
  let totalProfit = 0;
  let totalJobAmount = 0;
  let totalVendorFee = 0;
  const statusCounts = new Map<string, number>();
  const platformCounts = new Map<string, { count: number; amount: number }>();

  for (const j of jobs) {
    // Cancelled jobs keep all their data but shouldn't inflate profit totals.
    if (!isCancelled(j.job_status)) {
      totalProfit += j.profit ?? 0;
    }
    totalJobAmount += j.job_amount ?? 0;
    totalVendorFee += j.vendors_fee ?? 0;

    const status = j.job_status?.trim() || "Unspecified";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const platform = j.customer_charged_via?.trim() || "Unspecified";
    const existing = platformCounts.get(platform) ?? { count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += j.job_amount ?? 0;
    platformCounts.set(platform, existing);
  }

  return {
    totalProfit,
    totalJobAmount,
    totalVendorFee,
    jobCount: jobs.length,
    statusBreakdown: Array.from(statusCounts, ([status, count]) => ({ status, count })).sort(
      (a, b) => b.count - a.count
    ),
    platformBreakdown: Array.from(platformCounts, ([platform, v]) => ({ platform, ...v })).sort(
      (a, b) => b.count - a.count
    ),
  };
}

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's date in Philippine Time (UTC+8, no DST), matching the team's working day. */
export function todayISO() {
  return dateInPHT(new Date().toISOString());
}

/** The Philippine-Time calendar date (UTC+8, no DST) a given instant falls on. */
export function dateInPHT(isoInstant: string): string {
  return new Date(new Date(isoInstant).getTime() + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Sunday-Saturday week containing the given ISO date. */
export function weekRangeFor(dateISO: string): { start: string; end: string } {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const day = d.getUTCDay();
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - day);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Calendar month containing the given ISO date. */
export function monthRangeFor(dateISO: string): { start: string; end: string } {
  const [year, month] = dateISO.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

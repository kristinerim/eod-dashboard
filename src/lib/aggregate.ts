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
  return new Date(Date.now() + PHT_OFFSET_MS).toISOString().slice(0, 10);
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

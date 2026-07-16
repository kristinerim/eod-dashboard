import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  isEtaTrackedJob,
  isNeedsAttentionStatus,
  isOpenJobStatus,
  monthRangeFor,
  summarizeJobs,
  todayISO,
  weekRangeFor,
  type JobSummaryInput,
} from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import DispatchedList, { type DispatchedJob } from "@/components/DispatchedList";
import NeedsAttentionList, { type NeedsAttentionJob } from "@/components/NeedsAttentionList";
import AddTodayJobButton from "./AddTodayJobButton";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface JobRow extends JobSummaryInput {
  report_id: string;
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/10 p-3">
      <div className="text-xs text-black/50">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: reports, error } = await supabase
    .from("reports")
    .select("id, report_date")
    .order("report_date", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-600">Failed to load reports: {error.message}</p>;
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="space-y-4">
        <AddTodayJobButton />
        <p className="text-sm text-black/70">No reports yet. Add today&apos;s first job above.</p>
      </div>
    );
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select("report_id, profit, job_amount, vendors_fee, job_status, customer_charged_via")
    .in(
      "report_id",
      reports.map((r) => r.id)
    );

  const jobsByReport = new Map<string, JobRow[]>();
  for (const j of (jobs ?? []) as JobRow[]) {
    const list = jobsByReport.get(j.report_id) ?? [];
    list.push(j);
    jobsByReport.set(j.report_id, list);
  }

  const today = todayISO();
  const { start: weekStart, end: weekEnd } = weekRangeFor(today);
  const weekReportIds = reports
    .filter((r) => r.report_date >= weekStart && r.report_date <= weekEnd)
    .map((r) => r.id);
  const weekJobs = weekReportIds.flatMap((id) => jobsByReport.get(id) ?? []);

  const todayReportIds = reports.filter((r) => r.report_date === today).map((r) => r.id);
  const todayJobs = todayReportIds.flatMap((id) => jobsByReport.get(id) ?? []);
  const todaySummary = summarizeJobs(todayJobs);

  const { start: monthStart, end: monthEnd } = monthRangeFor(today);
  const monthReportIds = reports
    .filter((r) => r.report_date >= monthStart && r.report_date <= monthEnd)
    .map((r) => r.id);
  const monthJobs = monthReportIds.flatMap((id) => jobsByReport.get(id) ?? []);

  const incompleteToday = todayJobs.filter((j) => isOpenJobStatus(j.job_status)).length;
  const incompleteWeek = weekJobs.filter((j) => isOpenJobStatus(j.job_status)).length;
  const incompleteMonth = monthJobs.filter((j) => isOpenJobStatus(j.job_status)).length;

  const { data: dispatchedData } = await supabase
    .from("jobs")
    .select(
      "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, job_status, dispatched_at, time_dispatched, eta_minutes"
    )
    .in(
      "report_id",
      reports.map((r) => r.id)
    )
    .not("eta_minutes", "is", null);
  const dispatchedJobs: DispatchedJob[] = ((dispatchedData ?? []) as DispatchedJob[]).filter((j) =>
    isEtaTrackedJob(j)
  );

  const { data: needsAttentionData } = await supabase
    .from("jobs")
    .select("id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, job_status")
    .in(
      "report_id",
      reports.map((r) => r.id)
    );
  const needsAttentionJobs: NeedsAttentionJob[] = (
    (needsAttentionData ?? []) as (NeedsAttentionJob & { job_status: string | null })[]
  ).filter((j) => isNeedsAttentionStatus(j.job_status));

  return (
    <div className="space-y-8">
      <RealtimeRefresh tables={["jobs", "reports"]} />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Today — {formatDate(today)}</h1>
        <AddTodayJobButton />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Profit" value={formatCurrency(todaySummary.totalProfit)} />
        <Card label="Jobs" value={todaySummary.jobCount} />
        <Card label="Job amount" value={formatCurrency(todaySummary.totalJobAmount)} />
        <Card label="Vendor payment" value={formatCurrency(todaySummary.totalVendorFee)} />
      </div>

      <NeedsAttentionList jobs={needsAttentionJobs} />

      <div>
        <h2 className="mb-2 text-sm font-semibold">Incomplete jobs</h2>
        <div className="grid grid-cols-3 gap-3">
          <Card label="Today" value={incompleteToday} />
          <Card label="This week" value={incompleteWeek} />
          <Card label="This month" value={incompleteMonth} />
        </div>
      </div>

      {dispatchedJobs.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Dispatched — nearing ETA</h2>
            <Link href="/dispatched" className="text-sm underline">
              View all dispatched
            </Link>
          </div>
          <DispatchedList jobs={dispatchedJobs} limit={10} viewAllHref="/dispatched" />
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Reports</h2>
          <Link href="/weekly" className="text-sm underline">
            View weekly summaries
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Profit</th>
                <th className="px-4 py-2 font-medium">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {reports
                .filter((r) => (jobsByReport.get(r.id) ?? []).length > 0)
                .map((r) => {
                  const s = summarizeJobs(jobsByReport.get(r.id) ?? []);
                  return (
                    <tr key={r.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                      <td className="px-4 py-2">
                        <Link href={`/reports/${r.id}`} className="underline">
                          {formatDate(r.report_date)}
                        </Link>
                        {r.report_date === today && (
                          <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                            Today
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">{formatCurrency(s.totalProfit)}</td>
                      <td className="px-4 py-2">{s.jobCount}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

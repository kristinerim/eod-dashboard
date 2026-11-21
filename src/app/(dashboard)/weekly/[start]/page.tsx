import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { summarizeJobs, todayISO, weekRangeFor, type JobSummaryInput } from "@/lib/aggregate";
import { fetchAllRows } from "@/lib/supabase/paginate";
import RealtimeRefresh from "@/components/RealtimeRefresh";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatShortDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatLongDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface JobRow extends JobSummaryInput {
  report_id: string;
}

// One week (Sunday through Saturday, the same weeks as the Weekly summaries
// list), broken down day by day. Every figure is worked out with the same
// function the weekly list and the daily report use, from the same jobs.
export default async function WeekDetailPage({ params }: { params: Promise<{ start: string }> }) {
  const { start } = await params;
  // Only a real Sunday opens a week, so this always matches a row in the weekly list.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(new Date(`${start}T00:00:00Z`).getTime())) notFound();
  const { end } = weekRangeFor(start);
  if (weekRangeFor(start).start !== start) notFound();

  const supabase = await createClient();
  const { data: reports, error } = await supabase
    .from("reports")
    .select("id, report_date")
    .gte("report_date", start)
    .lte("report_date", end);
  if (error) return <p className="text-sm text-red-600">Failed to load reports: {error.message}</p>;

  const reportByDate = new Map((reports ?? []).map((r) => [r.report_date as string, r.id as string]));
  const reportIds = Array.from(reportByDate.values());

  const jobs = reportIds.length
    ? await fetchAllRows<JobRow>(() =>
        supabase
          .from("jobs")
          .select("report_id, profit, job_amount, vendors_fee, job_status, customer_charged_via")
          .in("report_id", reportIds)
      )
    : [];
  const jobsByReport = new Map<string, JobRow[]>();
  for (const j of jobs) {
    const list = jobsByReport.get(j.report_id) ?? [];
    list.push(j);
    jobsByReport.set(j.report_id, list);
  }

  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => {
    const reportId = reportByDate.get(date) ?? null;
    const dayJobs = reportId ? (jobsByReport.get(reportId) ?? []) : [];
    // A day with no report, or a report with no jobs, has nothing recorded.
    return { date, reportId, summary: dayJobs.length > 0 ? summarizeJobs(dayJobs) : null };
  });
  const week = summarizeJobs(jobs);

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["jobs", "reports"]} />

      <Link href="/weekly" className="text-sm text-qt-accent hover:underline">
        ← All weekly summaries
      </Link>

      <div>
        <h1 className="text-lg font-semibold">
          Week of {formatShortDate(start)} – {formatShortDate(end)}
        </h1>
        <p className="text-sm text-black/60">Sunday through Saturday. Click a day to open its full report.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Profit", formatCurrency(week.totalProfit)],
          ["Jobs", String(week.jobCount)],
          ["Job amount", formatCurrency(week.totalJobAmount)],
          ["Vendor payment", formatCurrency(week.totalVendorFee)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-black/50">Week total · {label}</div>
            <div className="mt-1 text-base font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Day</th>
              <th className="px-4 py-2 font-medium">Profit</th>
              <th className="px-4 py-2 font-medium">Jobs</th>
              <th className="px-4 py-2 font-medium">Job amount</th>
              <th className="px-4 py-2 font-medium">Vendor payment</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date} className="border-t border-black/10 hover:bg-black/[0.03]">
                <td className="px-4 py-2">
                  {d.reportId && d.summary ? (
                    <Link href={`/reports/${d.reportId}`} className="text-qt-accent underline-offset-2 hover:underline">
                      {formatLongDate(d.date)}
                    </Link>
                  ) : (
                    <span>{formatLongDate(d.date)}</span>
                  )}
                  {d.date === today && (
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Today</span>
                  )}
                </td>
                {d.summary ? (
                  <>
                    <td className="px-4 py-2">{formatCurrency(d.summary.totalProfit)}</td>
                    <td className="px-4 py-2">{d.summary.jobCount}</td>
                    <td className="px-4 py-2">{formatCurrency(d.summary.totalJobAmount)}</td>
                    <td className="px-4 py-2">{formatCurrency(d.summary.totalVendorFee)}</td>
                  </>
                ) : (
                  <td colSpan={4} className="px-4 py-2 text-black/50">
                    No Report Available
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-black/20 bg-black/[0.03] font-semibold">
            <tr>
              <td className="px-4 py-2">Week total</td>
              <td className="px-4 py-2">{formatCurrency(week.totalProfit)}</td>
              <td className="px-4 py-2">{week.jobCount}</td>
              <td className="px-4 py-2">{formatCurrency(week.totalJobAmount)}</td>
              <td className="px-4 py-2">{formatCurrency(week.totalVendorFee)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex justify-between text-sm">
        <Link href={`/weekly/${addDays(start, -7)}`} className="text-qt-accent hover:underline">
          ← Previous week
        </Link>
        <Link href={`/weekly/${addDays(start, 7)}`} className="text-qt-accent hover:underline">
          Next week →
        </Link>
      </div>
    </div>
  );
}

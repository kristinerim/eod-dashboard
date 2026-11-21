import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  isEtaTrackedJob,
  isNeedsAttentionStatus,
  monthRangeFor,
  needsRefund,
  todayISO,
  weekRangeFor,
} from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import DispatchedList, { type DispatchedJob } from "@/components/DispatchedList";
import NeedsAttentionList, { type NeedsAttentionJob } from "@/components/NeedsAttentionList";
import RefundRequiredList, { type RefundRequiredJob } from "@/components/RefundRequiredList";
import AddTodayJobButton from "./AddTodayJobButton";
import { rolloverStaleAppointments } from "@/lib/rollover";
import { fetchAllRows } from "@/lib/supabase/paginate";

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

// One row per report from the report_job_summaries() database function.
interface ReportSummary {
  report_id: string;
  job_count: number;
  total_profit: number;
  total_job_amount: number;
  total_vendor_fee: number;
  open_count: number;
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-qt-line bg-white px-5 py-4">
      <div className="text-[13px] font-medium text-qt-muted">{label}</div>
      <div className="mt-1 text-[28px] font-bold tracking-tight">{value}</div>
    </div>
  );
}

export default async function DashboardPage() {
  await rolloverStaleAppointments();

  const supabase = await createClient();

  // All of this runs at the same time, and none of it downloads the whole jobs
  // table: per-report totals are computed in the database, and the three lists
  // (dispatched, needs attention, refunds owed) are filtered there too. The JS
  // checks after each fetch are kept so what shows up is exactly what did before.
  const [reportsRes, summariesRes, dispatchedData, needsAttentionData, cancelledData] = await Promise.all([
    supabase.from("reports").select("id, report_date").order("report_date", { ascending: false }),
    supabase.rpc("report_job_summaries"),
    fetchAllRows<DispatchedJob>(() =>
      supabase
        .from("jobs")
        .select(
          "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, job_status, time_dispatched, eta_minutes"
        )
        .not("eta_minutes", "is", null)
        .not("time_dispatched", "is", null)
        .or("job_status.is.null,job_status.not.in.(Completed,Cancelled)")
    ),
    fetchAllRows<NeedsAttentionJob & { job_status: string | null }>(() =>
      supabase
        .from("jobs")
        .select("id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, job_status")
        .ilike("job_status", "needs attention")
    ),
    fetchAllRows<RefundRequiredJob & { job_status: string | null; customer_charged_via: string | null }>(() =>
      supabase
        .from("jobs")
        .select(
          "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, job_amount, refunded_to_client, cancellation_reason, job_status, customer_charged_via"
        )
        .eq("job_status", "Cancelled")
        .gt("job_amount", 0)
        .not("customer_charged_via", "is", null)
    ),
  ]);

  const reports = reportsRes.data;
  if (reportsRes.error) {
    return <p className="text-sm text-red-600">Failed to load reports: {reportsRes.error.message}</p>;
  }
  if (summariesRes.error) {
    return <p className="text-sm text-red-600">Failed to load report totals: {summariesRes.error.message}</p>;
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="space-y-4">
        <AddTodayJobButton />
        <p className="text-sm text-black/70">No reports yet. Add today&apos;s first job above, or use Create Job in the menu.</p>
      </div>
    );
  }

  const summaryByReport = new Map<string, ReportSummary>();
  for (const r of (summariesRes.data ?? []) as ReportSummary[]) {
    summaryByReport.set(r.report_id, {
      report_id: r.report_id,
      job_count: Number(r.job_count),
      total_profit: Number(r.total_profit),
      total_job_amount: Number(r.total_job_amount),
      total_vendor_fee: Number(r.total_vendor_fee),
      open_count: Number(r.open_count),
    });
  }
  const totalsFor = (ids: string[]) => {
    const t = { profit: 0, jobs: 0, amount: 0, vendorFee: 0, open: 0 };
    for (const id of ids) {
      const s = summaryByReport.get(id);
      if (!s) continue;
      t.profit += s.total_profit;
      t.jobs += s.job_count;
      t.amount += s.total_job_amount;
      t.vendorFee += s.total_vendor_fee;
      t.open += s.open_count;
    }
    return t;
  };

  const today = todayISO();
  const { start: weekStart, end: weekEnd } = weekRangeFor(today);
  const { start: monthStart, end: monthEnd } = monthRangeFor(today);
  const idsBetween = (start: string, end: string) =>
    reports.filter((r) => r.report_date >= start && r.report_date <= end).map((r) => r.id);

  // The Reports list shows only this week's days (Sunday through Saturday) that have jobs.
  const thisWeekReports = reports.filter(
    (r) => r.report_date >= weekStart && r.report_date <= weekEnd && (summaryByReport.get(r.id)?.job_count ?? 0) > 0
  );

  const todayTotals = totalsFor(reports.filter((r) => r.report_date === today).map((r) => r.id));
  const incompleteToday = todayTotals.open;
  const incompleteWeek = totalsFor(idsBetween(weekStart, weekEnd)).open;
  const incompleteMonth = totalsFor(idsBetween(monthStart, monthEnd)).open;

  const dispatchedJobs: DispatchedJob[] = dispatchedData.filter((j) => isEtaTrackedJob(j));
  const needsAttentionJobs: NeedsAttentionJob[] = needsAttentionData.filter((j) =>
    isNeedsAttentionStatus(j.job_status)
  );
  const refundRequiredJobs: RefundRequiredJob[] = cancelledData.filter((j) => needsRefund(j));

  return (
    <div className="space-y-5">
      <RealtimeRefresh tables={["jobs", "reports"]} />

      <div>
        <h1 className="text-2xl font-bold">Today</h1>
        <p className="mt-0.5 text-sm text-qt-muted">{formatDate(today)}</p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Card label="Profit" value={formatCurrency(todayTotals.profit)} />
        <Card label="Jobs" value={todayTotals.jobs} />
        <Card label="Job amount" value={formatCurrency(todayTotals.amount)} />
        <Card label="Vendor payment" value={formatCurrency(todayTotals.vendorFee)} />
      </div>

      <RefundRequiredList jobs={refundRequiredJobs} />

      <NeedsAttentionList jobs={needsAttentionJobs} />

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[2_1_620px] overflow-hidden rounded-xl border border-qt-line bg-white">
          <div className="flex items-center gap-2.5 border-b border-qt-line px-5 py-3.5">
            <h2 className="flex-1 text-[15px] font-bold">Dispatched — nearing ETA</h2>
            <Link href="/dispatched" className="text-[13px] font-medium text-qt-accent hover:underline">
              View all dispatched
            </Link>
          </div>
          {dispatchedJobs.length > 0 ? (
            <DispatchedList jobs={dispatchedJobs} limit={10} viewAllHref="/dispatched" bare />
          ) : (
            <p className="px-5 py-6 text-sm text-qt-muted">No dispatched jobs with an ETA right now.</p>
          )}
        </section>

        <section className="min-w-0 flex-[1_1_260px] overflow-hidden rounded-xl border border-qt-line bg-white">
          <div className="border-b border-qt-line px-5 py-3.5">
            <h2 className="text-[15px] font-bold">Incomplete jobs</h2>
          </div>
          {[
            ["Today", incompleteToday],
            ["This week", incompleteWeek],
            ["This month", incompleteMonth],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline border-t border-[#eef1f5] px-5 py-4 first:border-t-0">
              <span className="flex-1 text-sm text-[#2b3646]">{label}</span>
              <span className="text-[26px] font-bold">{value}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-qt-line bg-white">
        <div className="flex items-center gap-2.5 border-b border-qt-line px-5 py-3.5">
          <h2 className="flex-1 text-[15px] font-bold">
            Reports <span className="font-normal text-qt-muted">· this week, Sunday to Saturday</span>
          </h2>
          <Link href="/weekly" className="text-[13px] font-medium text-qt-accent hover:underline">
            View weekly summaries
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-[#f7f9fb] text-left text-xs uppercase tracking-wide text-qt-muted">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Date</th>
                <th className="px-5 py-2.5 font-semibold">Profit</th>
                <th className="px-5 py-2.5 font-semibold">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {thisWeekReports.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-6 text-center text-qt-muted">
                    No jobs yet this week.
                  </td>
                </tr>
              )}
              {thisWeekReports
                .map((r) => {
                  const s = summaryByReport.get(r.id)!;
                  return (
                    <tr key={r.id} className="border-t border-[#eef1f5] hover:bg-[#f7f9fb]">
                      <td className="px-5 py-3">
                        <Link href={`/reports/${r.id}`} className="font-medium text-qt-accent hover:underline">
                          {formatDate(r.report_date)}
                        </Link>
                        {r.report_date === today && (
                          <span className="ml-2 rounded-full bg-[#e3f6ea] px-2.5 py-0.5 text-xs font-semibold text-[#146c3a]">
                            Today
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-semibold">{formatCurrency(s.total_profit)}</td>
                      <td className="px-5 py-3">{s.job_count}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

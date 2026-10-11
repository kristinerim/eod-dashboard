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
    <div className="rounded-lg border border-black/10 p-3">
      <div className="text-xs text-black/50">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
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
        <div className="flex items-center gap-3">
          <Link href="/leads" className="text-sm text-black/60 underline hover:text-black">
            New inquiry? Create a lead
          </Link>
          <AddTodayJobButton />
        </div>
        <p className="text-sm text-black/70">No reports yet. Add today&apos;s first job above.</p>
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
    <div className="space-y-8">
      <RealtimeRefresh tables={["jobs", "reports"]} />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Today — {formatDate(today)}</h1>
        <div className="flex items-center gap-3">
          <Link href="/leads" className="text-sm text-black/60 underline hover:text-black">
            New inquiry? Create a lead
          </Link>
          <AddTodayJobButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Profit" value={formatCurrency(todayTotals.profit)} />
        <Card label="Jobs" value={todayTotals.jobs} />
        <Card label="Job amount" value={formatCurrency(todayTotals.amount)} />
        <Card label="Vendor payment" value={formatCurrency(todayTotals.vendorFee)} />
      </div>

      <RefundRequiredList jobs={refundRequiredJobs} />

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
                .filter((r) => (summaryByReport.get(r.id)?.job_count ?? 0) > 0)
                .map((r) => {
                  const s = summaryByReport.get(r.id)!;
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
                      <td className="px-4 py-2">{formatCurrency(s.total_profit)}</td>
                      <td className="px-4 py-2">{s.job_count}</td>
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

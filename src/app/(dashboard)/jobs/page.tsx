import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import JobsByDateGroups, { type GroupedJob } from "@/components/JobsByDateGroups";
import WindowControls from "@/components/WindowControls";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { windowDays, windowStartISO } from "@/lib/dateWindow";
import { dateInPHT } from "@/lib/aggregate";

// Every job of every status, grouped by the day it was added to, newest first.
// Same layout and the same "last N days" window as the Completed and Cancelled lists.
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = windowDays((await searchParams).days);
  const supabase = await createClient();

  // The window is counted in whole days of the day-reports the jobs belong to.
  const windowStartDate = dateInPHT(windowStartISO(days));

  const [jobList, totalResult] = await Promise.all([
    fetchAllRows<
      Omit<GroupedJob, "groupDate" | "sortKey"> & { row_number: number | null; reports: { report_date: string } | { report_date: string }[] | null }
    >(() =>
      supabase
        .from("jobs")
        .select(
          "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, profit, row_number, reports!inner(report_date)"
        )
        .gte("reports.report_date", windowStartDate)
        .order("id")
    ),
    supabase.from("jobs").select("id", { count: "exact", head: true }),
  ]);

  const grouped: GroupedJob[] = jobList.map((j) => {
    const report = Array.isArray(j.reports) ? j.reports[0] : j.reports;
    return {
      id: j.id,
      report_id: j.report_id,
      agent: j.agent,
      dispatcher: j.dispatcher,
      job_number: j.job_number,
      vendor_name: j.vendor_name,
      state: j.state,
      customer_phone: j.customer_phone,
      profit: j.profit,
      groupDate: report?.report_date ?? "Unknown",
      sortKey: j.row_number ?? 0,
    };
  });

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["jobs"]} />
      <h1 className="text-lg font-semibold">Jobs</h1>
      <p className="text-sm text-black/60">All jobs, grouped by the day they were added, newest first.</p>
      <WindowControls
        basePath="/jobs"
        days={days}
        shown={jobList.length}
        total={totalResult.count ?? jobList.length}
        noun="jobs"
      />
      <JobsByDateGroups jobs={grouped} emptyMessage="No jobs in this period." />
    </div>
  );
}

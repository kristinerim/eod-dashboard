import { createClient } from "@/lib/supabase/server";
import { dateInPHT } from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import JobsByDateGroups, { type GroupedJob } from "@/components/JobsByDateGroups";
import WindowControls from "@/components/WindowControls";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { windowDays, windowStartISO } from "@/lib/dateWindow";

export default async function CompletedJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = windowDays((await searchParams).days);
  const supabase = await createClient();

  // Only the recent days are loaded (look further back with the links below),
  // and the total is counted by the database rather than by downloading
  // every completed job.
  const [jobList, totalResult] = await Promise.all([
    fetchAllRows<Omit<GroupedJob, "groupDate" | "sortKey"> & { completed_at: string | null }>(() =>
      supabase
        .from("jobs")
        .select("id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, profit, completed_at")
        .eq("job_status", "Completed")
        .gte("completed_at", windowStartISO(days))
        .order("completed_at", { ascending: false })
    ),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("job_status", "Completed"),
  ]);
  const reportIds = Array.from(new Set(jobList.map((j) => j.report_id)));
  const { data: reports } = await supabase
    .from("reports")
    .select("id, report_date")
    .in("id", reportIds.length > 0 ? reportIds : ["00000000-0000-0000-0000-000000000000"]);
  const reportDateById = new Map((reports ?? []).map((r) => [r.id, r.report_date]));

  const grouped: GroupedJob[] = jobList.map((j) => ({
    ...j,
    groupDate: j.completed_at ? dateInPHT(j.completed_at) : (reportDateById.get(j.report_id) ?? "Unknown"),
    sortKey: j.completed_at ? new Date(j.completed_at).getTime() : 0,
  }));

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["jobs"]} />
      <h1 className="text-lg font-semibold">Completed Jobs</h1>
      <p className="text-sm text-black/60">Jobs marked Completed, grouped by completion date, newest first.</p>
      <WindowControls
        basePath="/completed-jobs"
        days={days}
        shown={jobList.length}
        total={totalResult.count ?? jobList.length}
        noun="completed jobs"
      />
      <JobsByDateGroups jobs={grouped} emptyMessage="No completed jobs in this period." />
    </div>
  );
}

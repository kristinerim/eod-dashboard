import { createClient } from "@/lib/supabase/server";
import { dateInPHT } from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import JobsByDateGroups, { type GroupedJob } from "@/components/JobsByDateGroups";

export default async function CancelledJobsPage() {
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, profit, cancellation_reason, cancelled_at"
    )
    .eq("job_status", "Cancelled");

  const jobList = jobs ?? [];
  const reportIds = Array.from(new Set(jobList.map((j) => j.report_id)));
  const { data: reports } = await supabase
    .from("reports")
    .select("id, report_date")
    .in("id", reportIds.length > 0 ? reportIds : ["00000000-0000-0000-0000-000000000000"]);
  const reportDateById = new Map((reports ?? []).map((r) => [r.id, r.report_date]));

  const grouped: GroupedJob[] = jobList.map((j) => ({
    ...j,
    groupDate: j.cancelled_at ? dateInPHT(j.cancelled_at) : (reportDateById.get(j.report_id) ?? "Unknown"),
    sortKey: j.cancelled_at ? new Date(j.cancelled_at).getTime() : 0,
  }));

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["jobs"]} />
      <h1 className="text-lg font-semibold">Cancelled Jobs</h1>
      <p className="text-sm text-black/60">
        Every job marked Cancelled, grouped by cancellation date, newest first.
      </p>
      <JobsByDateGroups jobs={grouped} showCancellationReason emptyMessage="No cancelled jobs yet." />
    </div>
  );
}

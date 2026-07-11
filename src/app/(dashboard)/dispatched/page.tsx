import { createClient } from "@/lib/supabase/server";
import { isOpenJobStatus } from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import DispatchedByDate, { type OpenJob } from "@/components/DispatchedByDate";

export default async function DispatchedPage() {
  const supabase = await createClient();

  const { data: reports } = await supabase
    .from("reports")
    .select("id, report_date")
    .order("report_date", { ascending: false });

  if (!reports || reports.length === 0) {
    return <p className="text-sm text-black/70">No reports yet.</p>;
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, job_status, dispatched_at, eta_minutes"
    )
    .in(
      "report_id",
      reports.map((r) => r.id)
    );

  const reportDateById = new Map(reports.map((r) => [r.id, r.report_date]));

  const openJobs: OpenJob[] = (jobs ?? [])
    .filter((j) => isOpenJobStatus(j.job_status))
    .map((j) => ({ ...j, report_date: reportDateById.get(j.report_id)! }));

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["jobs"]} />
      <h1 className="text-lg font-semibold">Dispatched jobs</h1>
      <p className="text-sm text-black/60">
        Every job not yet marked Completed or Cancelled, grouped by day. Live countdown shown
        where an ETA is set.
      </p>
      <DispatchedByDate jobs={openJobs} />
    </div>
  );
}

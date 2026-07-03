import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import DispatchedList, { type DispatchedJob } from "@/components/DispatchedList";

export default async function DispatchedPage() {
  const supabase = await createClient();

  const { data: report } = await supabase
    .from("reports")
    .select("id")
    .eq("report_date", todayISO())
    .maybeSingle();

  let jobs: DispatchedJob[] = [];

  if (report) {
    const { data } = await supabase
      .from("jobs")
      .select("id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, dispatched_at, eta_minutes")
      .eq("report_id", report.id)
      .ilike("job_status", "dispatched")
      .not("dispatched_at", "is", null)
      .not("eta_minutes", "is", null);

    jobs = (data ?? []) as DispatchedJob[];
  }

  return (
    <div className="space-y-4">
      {report && <RealtimeRefresh tables={["jobs"]} filter={`report_id=eq.${report.id}`} />}
      <h1 className="text-lg font-semibold">Dispatched jobs</h1>
      <p className="text-sm text-black/60">
        Live countdown to each job&apos;s ETA, soonest first.
      </p>
      <DispatchedList jobs={jobs} />
    </div>
  );
}

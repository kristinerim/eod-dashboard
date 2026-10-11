import { createClient } from "@/lib/supabase/server";
import { dateInPHT } from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import JobsByDateGroups, { type GroupedJob } from "@/components/JobsByDateGroups";
import WindowControls from "@/components/WindowControls";
import { fetchAllRows } from "@/lib/supabase/paginate";
import { windowDays, windowStartISO } from "@/lib/dateWindow";

export default async function CancelledJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = windowDays((await searchParams).days);
  const supabase = await createClient();

  type CancelledRow = Omit<GroupedJob, "groupDate" | "sortKey"> & { cancelled_at: string | null };
  const columns =
    "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, profit, cancellation_reason, cancelled_at, job_amount, refunded_to_client, customer_charged_via";
  const since = windowStartISO(days);

  const [recent, olderCharged, totalResult] = await Promise.all([
    fetchAllRows<CancelledRow>(() =>
      supabase.from("jobs").select(columns).eq("job_status", "Cancelled").gte("cancelled_at", since).order("cancelled_at", { ascending: false })
    ),
    // A cancelled job that was charged but not fully refunded needs follow-up
    // however old it is, so those are always listed.
    fetchAllRows<CancelledRow>(() =>
      supabase
        .from("jobs")
        .select(columns)
        .eq("job_status", "Cancelled")
        .lt("cancelled_at", since)
        .not("customer_charged_via", "is", null)
        .gt("job_amount", 0)
        .order("cancelled_at", { ascending: false })
    ),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("job_status", "Cancelled"),
  ]);
  const olderOwing = olderCharged.filter((j) => (j.refunded_to_client ?? 0) < (j.job_amount ?? 0));
  const jobList = [...recent, ...olderOwing];
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
      <p className="text-sm text-black/60">Jobs marked Cancelled, grouped by cancellation date, newest first.</p>
      <WindowControls
        basePath="/cancelled-jobs"
        days={days}
        shown={jobList.length}
        total={totalResult.count ?? jobList.length}
        noun="cancelled jobs"
      />
      {olderOwing.length > 0 && (
        <p className="text-sm font-medium text-amber-700">
          Includes {olderOwing.length} older cancelled job{olderOwing.length === 1 ? "" : "s"} that still need a
          refund.
        </p>
      )}
      <JobsByDateGroups jobs={grouped} showCancellationReason emptyMessage="No cancelled jobs in this period." />
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO } from "@/lib/aggregate";
import { fetchAllRows } from "@/lib/supabase/paginate";

/**
 * A job in Appointment status isn't operational yet — dispatch is what makes
 * it operational — so it isn't tied to any real day and keeps rolling
 * forward to today's report every day, vendor or no vendor, until it's
 * dispatched. At that point job-actions.ts's dispatch-date move takes over
 * as the source of truth and this stops applying.
 *
 * Runs opportunistically whenever a dashboard/report page loads rather than
 * on a schedule — there's no background cron here.
 */
export async function rolloverStaleAppointments(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const admin = createAdminClient();
  const today = todayISO();

  const { data: pastReports } = await admin.from("reports").select("id").lt("report_date", today);
  const pastReportIds = (pastReports ?? []).map((r) => r.id);
  if (pastReportIds.length === 0) return;

  const staleJobs = await fetchAllRows<{ id: string; report_id: string }>(() =>
    admin
      .from("jobs")
      .select("id, report_id")
      .eq("job_status", "Appointment")
      .in("report_id", pastReportIds)
      .order("row_number", { ascending: true })
  );

  if (staleJobs.length === 0) return;

  const { data: todayReport, error: todayReportError } = await admin
    .from("reports")
    .upsert({ report_date: today, uploaded_by: user.id }, { onConflict: "report_date" })
    .select("id")
    .single();
  if (todayReportError || !todayReport) return;

  const { count } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", todayReport.id);

  let nextRowNumber = (count ?? 0) + 1;

  for (const job of staleJobs) {
    if (job.report_id === todayReport.id) continue;
    await admin
      .from("jobs")
      .update({ report_id: todayReport.id, row_number: nextRowNumber })
      .eq("id", job.id);
    nextRowNumber += 1;
  }
}

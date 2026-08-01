import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO } from "@/lib/aggregate";

/**
 * An appointment job with no vendor yet isn't tied to any real operational
 * day, so it rolls forward to today's report every day until a vendor is
 * assigned — otherwise it would stay stranded on whatever day it happened to
 * be created. Once a vendor is assigned it stops rolling and stays put until
 * it's dispatched, at which point job-actions.ts's dispatch-date move takes
 * over as the source of truth.
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

  const { data: staleJobs } = await admin
    .from("jobs")
    .select("id, report_id")
    .eq("job_status", "Appointment")
    .or("vendor_name.is.null,vendor_name.eq.")
    .in("report_id", pastReportIds)
    .order("row_number", { ascending: true });

  if (!staleJobs || staleJobs.length === 0) return;

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

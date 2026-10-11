import { getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayISO } from "@/lib/aggregate";
import { fetchAllRows } from "@/lib/supabase/paginate";

// Remembered per server instance: once checked for today, don't re-check on
// every page load. Appointments only go stale at midnight (or if someone moves
// an old day's job back to Appointment), so a few minutes' delay is harmless.
const CHECK_EVERY_MS = 5 * 60 * 1000;
let lastCheck = { date: "", at: 0 };

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
  const today = todayISO();
  if (lastCheck.date === today && Date.now() - lastCheck.at < CHECK_EVERY_MS) return;

  const admin = createAdminClient();

  // Appointment jobs are few, so look for them first: the common case (nothing
  // to move) then costs one small query instead of listing every past report.
  const appointments = await fetchAllRows<{ id: string; report_id: string }>(() =>
    admin
      .from("jobs")
      .select("id, report_id")
      .eq("job_status", "Appointment")
      .order("row_number", { ascending: true })
  );

  let staleJobs: { id: string; report_id: string }[] = [];
  if (appointments.length > 0) {
    const { data: pastReports } = await admin.from("reports").select("id").lt("report_date", today);
    const pastReportIds = new Set((pastReports ?? []).map((r) => r.id));
    staleJobs = appointments.filter((j) => pastReportIds.has(j.report_id));
  }

  if (staleJobs.length === 0) {
    lastCheck = { date: today, at: Date.now() };
    return;
  }

  const user = await getCurrentUser();
  if (!user) return;

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
  lastCheck = { date: today, at: Date.now() };
}


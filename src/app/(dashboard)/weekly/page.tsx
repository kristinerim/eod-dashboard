import { createClient } from "@/lib/supabase/server";
import { summarizeJobs, weekRangeFor, type JobSummaryInput } from "@/lib/aggregate";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatShortDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface JobRow extends JobSummaryInput {
  report_id: string;
}

export default async function WeeklyPage() {
  const supabase = await createClient();

  const { data: reports, error } = await supabase
    .from("reports")
    .select("id, report_date")
    .order("report_date", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-600">Failed to load reports: {error.message}</p>;
  }

  if (!reports || reports.length === 0) {
    return <p className="text-sm text-black/70">No reports yet.</p>;
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select("report_id, profit, job_amount, vendors_fee, job_status, customer_charged_via")
    .in(
      "report_id",
      reports.map((r) => r.id)
    );

  const jobsByReport = new Map<string, JobRow[]>();
  for (const j of (jobs ?? []) as JobRow[]) {
    const list = jobsByReport.get(j.report_id) ?? [];
    list.push(j);
    jobsByReport.set(j.report_id, list);
  }

  const weekMap = new Map<string, { start: string; end: string; jobs: JobRow[] }>();
  for (const r of reports) {
    const { start, end } = weekRangeFor(r.report_date);
    const entry = weekMap.get(start) ?? { start, end, jobs: [] };
    entry.jobs.push(...(jobsByReport.get(r.id) ?? []));
    weekMap.set(start, entry);
  }

  const weeks = Array.from(weekMap.values()).sort((a, b) => (a.start < b.start ? 1 : -1));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Weekly summaries</h1>
      <p className="text-sm text-black/60">Weeks run Sunday through Saturday.</p>
      <div className="overflow-hidden rounded-lg border border-black/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Week</th>
              <th className="px-4 py-2 font-medium">Profit</th>
              <th className="px-4 py-2 font-medium">Jobs</th>
              <th className="px-4 py-2 font-medium">Job amount</th>
              <th className="px-4 py-2 font-medium">Vendor payment</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const s = summarizeJobs(w.jobs);
              return (
                <tr key={w.start} className="border-t border-black/10">
                  <td className="px-4 py-2">
                    {formatShortDate(w.start)} – {formatShortDate(w.end)}
                  </td>
                  <td className="px-4 py-2">{formatCurrency(s.totalProfit)}</td>
                  <td className="px-4 py-2">{s.jobCount}</td>
                  <td className="px-4 py-2">{formatCurrency(s.totalJobAmount)}</td>
                  <td className="px-4 py-2">{formatCurrency(s.totalVendorFee)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/profile";
import {
  dateInPHT,
  isActiveJobStatus,
  isCompletedStatus,
  isDispatchedStatus,
  monthRangeFor,
  summarizeJobs,
  todayISO,
  weekRangeFor,
  type JobSummaryInput,
} from "@/lib/aggregate";

interface JobRow extends JobSummaryInput {
  report_id: string;
  job_number: string | null;
  vendor_name: string | null;
  dispatched_at: string | null;
}

interface TimeEntry {
  clock_in: string;
  clock_out: string | null;
}

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatHours(ms: number) {
  return `${(ms / 3600000).toFixed(2)}h`;
}

function durationMs(e: TimeEntry): number {
  const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
  return end - new Date(e.clock_in).getTime();
}

function jobsBetween(jobs: JobRow[], dateById: Map<string, string>, start: string, end: string) {
  return jobs.filter((j) => {
    const d = dateById.get(j.report_id);
    return d !== undefined && d >= start && d <= end;
  });
}

function hoursBetween(entries: TimeEntry[], start: string, end: string) {
  return entries
    .filter((e) => {
      const d = dateInPHT(e.clock_in);
      return d >= start && d <= end;
    })
    .reduce((sum, e) => sum + durationMs(e), 0);
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const currentProfile = await getCurrentProfile();
  if (currentProfile?.role !== "manager") {
    return <p className="text-sm text-black/70">Only managers can view agent details.</p>;
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("profiles")
    .select("id, agent_name, email, role")
    .eq("id", id)
    .eq("role", "agent")
    .single();

  if (!agent) notFound();

  const today = todayISO();
  const week = weekRangeFor(today);
  const month = monthRangeFor(today);
  const fetchStart = week.start < month.start ? week.start : month.start;
  const fetchEnd = week.end > month.end ? week.end : month.end;

  const { data: reports } = await supabase
    .from("reports")
    .select("id, report_date")
    .gte("report_date", fetchStart)
    .lte("report_date", fetchEnd);

  const reportIds = (reports ?? []).map((r) => r.id);
  const dateByReportId = new Map((reports ?? []).map((r) => [r.id, r.report_date]));

  const { data: jobsData } = agent.agent_name
    ? await supabase
        .from("jobs")
        .select(
          "report_id, profit, job_amount, vendors_fee, job_status, customer_charged_via, job_number, vendor_name, dispatched_at"
        )
        .eq("agent", agent.agent_name)
        .in("report_id", reportIds.length > 0 ? reportIds : ["00000000-0000-0000-0000-000000000000"])
    : { data: [] };

  const jobs = (jobsData ?? []) as JobRow[];

  const dayJobs = jobsBetween(jobs, dateByReportId, today, today);
  const weekJobs = jobsBetween(jobs, dateByReportId, week.start, week.end);
  const monthJobs = jobsBetween(jobs, dateByReportId, month.start, month.end);

  const daySummary = summarizeJobs(dayJobs);
  const weekSummary = summarizeJobs(weekJobs);
  const monthSummary = summarizeJobs(monthJobs);

  const activeJobs = monthJobs.filter((j) => isActiveJobStatus(j.job_status));

  const avgProfitPerJob = monthSummary.jobCount > 0 ? monthSummary.totalProfit / monthSummary.jobCount : 0;

  const { data: entriesData } = await supabase
    .from("time_entries")
    .select("clock_in, clock_out")
    .eq("user_id", agent.id);

  const entries = (entriesData ?? []) as TimeEntry[];
  const isOnline = entries.some((e) => !e.clock_out);
  const dayHours = hoursBetween(entries, today, today);
  const weekHours = hoursBetween(entries, week.start, week.end);
  const monthHours = hoursBetween(entries, month.start, month.end);

  const rows = [
    {
      label: "Completed jobs",
      day: dayJobs.filter((j) => isCompletedStatus(j.job_status)).length,
      week: weekJobs.filter((j) => isCompletedStatus(j.job_status)).length,
      month: monthJobs.filter((j) => isCompletedStatus(j.job_status)).length,
    },
    {
      label: "Dispatched jobs",
      day: dayJobs.filter((j) => isDispatchedStatus(j.job_status)).length,
      week: weekJobs.filter((j) => isDispatchedStatus(j.job_status)).length,
      month: monthJobs.filter((j) => isDispatchedStatus(j.job_status)).length,
    },
    {
      label: "Total jobs",
      day: daySummary.jobCount,
      week: weekSummary.jobCount,
      month: monthSummary.jobCount,
    },
    {
      label: "Total profit",
      day: formatCurrency(daySummary.totalProfit),
      week: formatCurrency(weekSummary.totalProfit),
      month: formatCurrency(monthSummary.totalProfit),
    },
    {
      label: "Hours worked",
      day: formatHours(dayHours),
      week: formatHours(weekHours),
      month: formatHours(monthHours),
    },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/agents" className="text-sm underline">
        ← Back to agents
      </Link>

      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">{agent.agent_name ?? "Unnamed agent"}</h1>
        {isOnline ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Online
          </span>
        ) : (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/50">
            Offline
          </span>
        )}
      </div>
      <p className="text-sm text-black/60">{agent.email ?? "-"}</p>

      <div className="overflow-hidden rounded-lg border border-black/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-4 py-2 font-medium"></th>
              <th className="px-4 py-2 font-medium">Today</th>
              <th className="px-4 py-2 font-medium">This week</th>
              <th className="px-4 py-2 font-medium">This month</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-black/10">
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className="px-4 py-2">{r.day}</td>
                <td className="px-4 py-2">{r.week}</td>
                <td className="px-4 py-2">{r.month}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-black/10 p-3">
          <div className="text-xs text-black/50">Active jobs (dispatched, in progress, on hold)</div>
          <div className="mt-1 text-base font-semibold">{activeJobs.length}</div>
        </div>
        <div className="rounded-lg border border-black/10 p-3">
          <div className="text-xs text-black/50">Avg profit / job (this month)</div>
          <div className="mt-1 text-base font-semibold">{formatCurrency(avgProfitPerJob)}</div>
        </div>
      </div>

      {activeJobs.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Active jobs</h2>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Job #</th>
                  <th className="px-4 py-2 font-medium">Vendor</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {activeJobs.map((j, i) => (
                  <tr key={i} className="border-t border-black/10">
                    <td className="px-4 py-2">{j.job_number ?? "-"}</td>
                    <td className="px-4 py-2">{j.vendor_name ?? "-"}</td>
                    <td className="px-4 py-2">{j.job_status ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

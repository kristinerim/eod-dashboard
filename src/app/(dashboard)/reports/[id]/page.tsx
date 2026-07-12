import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JobsTable, { type Job } from "./JobsTable";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import { summarizeJobs, todayISO } from "@/lib/aggregate";
import { getCurrentProfile, getAgentNameOptions, isSupervisor } from "@/lib/profile";

function formatCurrency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: report } = await supabase
    .from("reports")
    .select("id, report_date")
    .eq("id", id)
    .single();

  if (!report) notFound();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("report_id", id)
    .order("row_number", { ascending: true });

  const jobList = (jobs ?? []) as Job[];
  const summary = summarizeJobs(jobList);
  const isToday = report.report_date === todayISO();
  const profile = await getCurrentProfile();
  const canDelete = isSupervisor(profile?.role);
  const agentOptions = await getAgentNameOptions();

  const cards = [
    { label: "Total profit", value: formatCurrency(summary.totalProfit) },
    { label: "Total jobs", value: summary.jobCount },
    { label: "Total job amount", value: formatCurrency(summary.totalJobAmount) },
    { label: "Vendor payment", value: formatCurrency(summary.totalVendorFee) },
  ];

  return (
    <div className="space-y-8">
      {isToday && <RealtimeRefresh tables={["jobs"]} filter={`report_id=eq.${id}`} />}

      <h1 className="flex items-center gap-2 text-lg font-semibold">
        {formatDate(report.report_date)}
        {isToday && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Today · live
          </span>
        )}
      </h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-black/50">{c.label}</div>
            <div className="mt-1 text-base font-semibold">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold">By status</h2>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {summary.statusBreakdown.map((s) => (
                  <tr key={s.status} className="border-t border-black/10">
                    <td className="px-4 py-2">{s.status}</td>
                    <td className="px-4 py-2">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold">By platform (charged via)</h2>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Platform</th>
                  <th className="px-4 py-2 font-medium">Jobs</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.platformBreakdown.map((p) => (
                  <tr key={p.platform} className="border-t border-black/10">
                    <td className="px-4 py-2">{p.platform}</td>
                    <td className="px-4 py-2">{p.count}</td>
                    <td className="px-4 py-2">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Jobs ({jobList.length})</h2>
        <JobsTable
          jobs={jobList}
          reportId={id}
          isToday={isToday}
          canDelete={canDelete}
          agentOptions={agentOptions}
          currentRole={profile?.role}
          currentAgentName={profile?.agent_name}
        />
      </div>
    </div>
  );
}

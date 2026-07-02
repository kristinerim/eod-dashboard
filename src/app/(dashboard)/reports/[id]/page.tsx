import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import JobsTable, { type Job } from "./JobsTable";

function formatCurrency(n: number | null) {
  if (n === null) return "-";
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

interface PlatformRow {
  platform: string;
  rate: number | null;
  count: number | null;
  amount: number | null;
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
    .select("*")
    .eq("id", id)
    .single();

  if (!report) notFound();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("report_id", id)
    .order("row_number", { ascending: true });

  const platformBreakdown = (report.platform_breakdown ?? []) as PlatformRow[];

  const cards = [
    { label: "Total profit", value: formatCurrency(report.total_profit) },
    { label: "Converted jobs", value: report.total_converted_jobs ?? "-" },
    { label: "Total job amount", value: formatCurrency(report.total_job_amount) },
    { label: "Vendor payment", value: formatCurrency(report.total_vendor_payment) },
    { label: "Refunded to client", value: formatCurrency(report.total_refunded_to_client) },
    { label: "Completed jobs", value: report.total_completed_jobs ?? "-" },
    { label: "Cancelled jobs", value: report.total_cancelled_jobs ?? "-" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold">{formatDate(report.report_date)}</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-black/10 p-3">
            <div className="text-xs text-black/50">{c.label}</div>
            <div className="mt-1 text-base font-semibold">{c.value}</div>
          </div>
        ))}
      </div>

      {platformBreakdown.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Platform breakdown</h2>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Platform</th>
                  <th className="px-4 py-2 font-medium">Rate</th>
                  <th className="px-4 py-2 font-medium">Count</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {platformBreakdown.map((p, i) => (
                  <tr key={i} className="border-t border-black/10">
                    <td className="px-4 py-2">{p.platform}</td>
                    <td className="px-4 py-2">
                      {p.rate !== null ? `${(p.rate * 100).toFixed(2)}%` : "-"}
                    </td>
                    <td className="px-4 py-2">{p.count ?? "-"}</td>
                    <td className="px-4 py-2">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Jobs ({jobs?.length ?? 0})</h2>
        <JobsTable jobs={(jobs ?? []) as Job[]} />
      </div>
    </div>
  );
}

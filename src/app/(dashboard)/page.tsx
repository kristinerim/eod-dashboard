import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: reports, error } = await supabase
    .from("reports")
    .select(
      "id, report_date, total_profit, total_converted_jobs, total_completed_jobs, total_cancelled_jobs"
    )
    .order("report_date", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-600">Failed to load reports: {error.message}</p>;
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="text-sm text-black/70">
        No reports yet.{" "}
        <Link href="/upload" className="underline">
          Upload your first EOD report
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Reports</h1>
      <div className="overflow-hidden rounded-lg border border-black/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Profit</th>
              <th className="px-4 py-2 font-medium">Converted jobs</th>
              <th className="px-4 py-2 font-medium">Completed</th>
              <th className="px-4 py-2 font-medium">Cancelled</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                <td className="px-4 py-2">
                  <Link href={`/reports/${r.id}`} className="underline">
                    {formatDate(r.report_date)}
                  </Link>
                </td>
                <td className="px-4 py-2">{formatCurrency(r.total_profit)}</td>
                <td className="px-4 py-2">{r.total_converted_jobs ?? "-"}</td>
                <td className="px-4 py-2">{r.total_completed_jobs ?? "-"}</td>
                <td className="px-4 py-2">{r.total_cancelled_jobs ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

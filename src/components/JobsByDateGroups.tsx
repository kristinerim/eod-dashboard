import Link from "next/link";

export interface GroupedJob {
  id: string;
  report_id: string;
  agent: string | null;
  dispatcher: string | null;
  job_number: string | null;
  vendor_name: string | null;
  state: string | null;
  customer_phone: string | null;
  profit: number | null;
  cancellation_reason?: string | null;
  groupDate: string;
  sortKey: number;
}

function formatDate(d: string) {
  if (d === "Unknown") return "Unknown date";
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatCurrency(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function JobsByDateGroups({
  jobs,
  showCancellationReason,
  emptyMessage,
}: {
  jobs: GroupedJob[];
  showCancellationReason?: boolean;
  emptyMessage: string;
}) {
  const byDate = new Map<string, GroupedJob[]>();
  for (const j of jobs) {
    const list = byDate.get(j.groupDate) ?? [];
    list.push(j);
    byDate.set(j.groupDate, list);
  }

  const groups = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, dateJobs]) => ({
      date,
      jobs: [...dateJobs].sort((a, b) => b.sortKey - a.sortKey),
    }));

  if (groups.length === 0) {
    return <p className="text-sm text-black/50">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-6">
      {groups.map(({ date, jobs: dateJobs }) => (
        <div key={date}>
          <h2 className="mb-2 text-sm font-semibold">
            {formatDate(date)} ({dateJobs.length})
          </h2>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Actions</th>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Dispatcher</th>
                  <th className="px-4 py-2 font-medium">Job #</th>
                  <th className="px-4 py-2 font-medium">Vendor</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">Profit</th>
                  {showCancellationReason && (
                    <th className="px-4 py-2 font-medium">Cancellation reason</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {dateJobs.map((job) => (
                  <tr key={job.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                    <td className="px-4 py-2">
                      <Link
                        href={`/reports/${job.report_id}/jobs/${job.id}`}
                        target="_blank"
                        className="text-black/60 hover:text-black hover:underline"
                      >
                        View
                      </Link>
                    </td>
                    <td className="px-4 py-2">{job.agent ?? "-"}</td>
                    <td className="px-4 py-2">{job.dispatcher ?? "-"}</td>
                    <td className="px-4 py-2">{job.job_number ?? "-"}</td>
                    <td className="px-4 py-2">{job.vendor_name ?? "-"}</td>
                    <td className="px-4 py-2">{job.state ?? "-"}</td>
                    <td className="px-4 py-2">{formatCurrency(job.profit)}</td>
                    {showCancellationReason && (
                      <td className="px-4 py-2">{job.cancellation_reason ?? "-"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

import Link from "next/link";

export interface NeedsAttentionJob {
  id: string;
  report_id: string;
  agent: string | null;
  dispatcher: string | null;
  job_number: string | null;
  vendor_name: string | null;
  state: string | null;
  customer_phone: string | null;
}

export default function NeedsAttentionList({ jobs }: { jobs: NeedsAttentionJob[] }) {
  if (jobs.length === 0) return null;

  return (
    <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4">
      <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-red-700">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" />
        Needs Attention ({jobs.length})
      </h2>
      <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-red-100 text-left">
            <tr>
              <th className="px-4 py-2 font-medium text-red-800">Actions</th>
              <th className="px-4 py-2 font-medium text-red-800">Agent</th>
              <th className="px-4 py-2 font-medium text-red-800">Dispatcher</th>
              <th className="px-4 py-2 font-medium text-red-800">Job #</th>
              <th className="px-4 py-2 font-medium text-red-800">Vendor</th>
              <th className="px-4 py-2 font-medium text-red-800">State</th>
              <th className="px-4 py-2 font-medium text-red-800">Customer phone</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-red-100 hover:bg-red-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/reports/${job.report_id}/jobs/${job.id}`}
                    target="_blank"
                    className="font-medium text-red-700 hover:underline"
                  >
                    View
                  </Link>
                </td>
                <td className="px-4 py-2">{job.agent ?? "-"}</td>
                <td className="px-4 py-2">{job.dispatcher ?? "-"}</td>
                <td className="px-4 py-2">{job.job_number ?? "-"}</td>
                <td className="px-4 py-2">{job.vendor_name ?? "-"}</td>
                <td className="px-4 py-2">{job.state ?? "-"}</td>
                <td className="px-4 py-2">{job.customer_phone ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

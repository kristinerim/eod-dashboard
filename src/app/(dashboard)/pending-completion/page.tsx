import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ElapsedBadge from "@/components/ElapsedBadge";

const STATUS = "Service Rendered – Pending Completion";

interface PendingJob {
  id: string;
  report_id: string;
  agent: string | null;
  dispatcher: string | null;
  job_number: string | null;
  vendor_name: string | null;
  state: string | null;
  customer_phone: string | null;
  pending_completion_at: string | null;
}

export default async function PendingCompletionPage() {
  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, report_id, agent, dispatcher, job_number, vendor_name, state, customer_phone, pending_completion_at"
    )
    .eq("job_status", STATUS);

  const pendingJobs = (jobs ?? []) as PendingJob[];

  const sorted = [...pendingJobs].sort((a, b) => {
    const aTime = a.pending_completion_at ? new Date(a.pending_completion_at).getTime() : 0;
    const bTime = b.pending_completion_at ? new Date(b.pending_completion_at).getTime() : 0;
    return aTime - bTime;
  });

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["jobs"]} />
      <h1 className="text-lg font-semibold">Service Rendered – Pending Completion</h1>
      <p className="text-sm text-black/60">
        Every job currently in this status, oldest first. A job leaves this list as soon as its
        status changes to Completed or anything else.
      </p>

      {sorted.length === 0 ? (
        <p className="text-sm text-black/50">No jobs are pending completion right now.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Actions</th>
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Job #</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Customer phone</th>
                <th className="px-4 py-2 font-medium">Time pending</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((job) => (
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
                  <td className="px-4 py-2">{job.job_number ?? "-"}</td>
                  <td className="px-4 py-2">{job.vendor_name ?? "-"}</td>
                  <td className="px-4 py-2">{job.state ?? "-"}</td>
                  <td className="px-4 py-2">{job.customer_phone ?? "-"}</td>
                  <td className="px-4 py-2">
                    {job.pending_completion_at ? (
                      <ElapsedBadge since={job.pending_completion_at} />
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

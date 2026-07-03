"use client";

import { useMemo } from "react";
import Link from "next/link";
import CountdownBadge from "./CountdownBadge";

export interface DispatchedJob {
  id: string;
  report_id: string;
  agent: string | null;
  dispatcher: string | null;
  job_number: string | null;
  vendor_name: string | null;
  state: string | null;
  customer_phone: string | null;
  dispatched_at: string;
  eta_minutes: number;
}

interface Props {
  jobs: DispatchedJob[];
  limit?: number;
  viewAllHref?: string;
}

export default function DispatchedList({ jobs, limit, viewAllHref }: Props) {
  const sorted = useMemo(() => {
    return [...jobs]
      .map((j) => ({
        job: j,
        deadline: new Date(j.dispatched_at).getTime() + j.eta_minutes * 60 * 1000,
      }))
      .sort((a, b) => a.deadline - b.deadline);
  }, [jobs]);

  const shown = limit ? sorted.slice(0, limit) : sorted;

  if (shown.length === 0) {
    return <p className="text-sm text-black/50">No dispatched jobs with an ETA right now.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-black/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-4 py-2 font-medium">Job #</th>
              <th className="px-4 py-2 font-medium">Vendor</th>
              <th className="px-4 py-2 font-medium">State</th>
              <th className="px-4 py-2 font-medium">ETA</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ job, deadline }) => (
              <tr key={job.id} className="border-t border-black/10">
                <td className="px-4 py-2">{job.agent ?? "-"}</td>
                <td className="px-4 py-2">{job.job_number ?? "-"}</td>
                <td className="px-4 py-2">{job.vendor_name ?? "-"}</td>
                <td className="px-4 py-2">{job.state ?? "-"}</td>
                <td className="px-4 py-2">
                  <CountdownBadge deadline={deadline} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewAllHref && jobs.length > shown.length && (
        <Link href={viewAllHref} className="text-sm underline">
          View all {jobs.length} dispatched jobs
        </Link>
      )}
    </div>
  );
}

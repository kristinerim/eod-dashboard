"use client";

import { useMemo } from "react";
import Link from "next/link";
import CountdownBadge from "./CountdownBadge";

export interface OpenJob {
  id: string;
  report_id: string;
  report_date: string;
  agent: string | null;
  dispatcher: string | null;
  job_number: string | null;
  vendor_name: string | null;
  state: string | null;
  customer_phone: string | null;
  job_status: string | null;
  dispatched_at: string | null;
  eta_minutes: number | null;
}

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function deadlineFor(job: OpenJob): number | null {
  if (!job.dispatched_at || job.eta_minutes === null) return null;
  return new Date(job.dispatched_at).getTime() + job.eta_minutes * 60 * 1000;
}

export default function DispatchedByDate({ jobs }: { jobs: OpenJob[] }) {
  const groups = useMemo(() => {
    const byDate = new Map<string, OpenJob[]>();
    for (const j of jobs) {
      const list = byDate.get(j.report_date) ?? [];
      list.push(j);
      byDate.set(j.report_date, list);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, dateJobs]) => ({
        date,
        rows: dateJobs
          .map((job) => ({ job, deadline: deadlineFor(job) }))
          .sort((a, b) => {
            if (a.deadline === null && b.deadline === null) return 0;
            if (a.deadline === null) return 1;
            if (b.deadline === null) return -1;
            return a.deadline - b.deadline;
          }),
      }));
  }, [jobs]);

  if (groups.length === 0) {
    return <p className="text-sm text-black/50">No open jobs right now.</p>;
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.date}>
          <h2 className="mb-2 text-sm font-semibold">
            {formatDate(g.date)} <span className="text-black/40">({g.rows.length})</span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Actions</th>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Job #</th>
                  <th className="px-4 py-2 font-medium">Vendor</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">ETA</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(({ job, deadline }) => (
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
                    <td className="px-4 py-2">{job.job_status ?? "-"}</td>
                    <td className="px-4 py-2">{job.state ?? "-"}</td>
                    <td className="px-4 py-2">
                      <CountdownBadge deadline={deadline} />
                    </td>
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

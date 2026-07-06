import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/aggregate";
import type { Job } from "../../JobsTable";
import JobDetailActions from "./JobDetailActions";

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

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US");
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string; jobId: string }>;
}) {
  const { id, jobId } = await params;
  const supabase = await createClient();

  const { data: report } = await supabase
    .from("reports")
    .select("id, report_date")
    .eq("id", id)
    .single();

  if (!report) notFound();

  const { data: job } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("report_id", id)
    .single();

  if (!job) notFound();

  const isToday = report.report_date === todayISO();

  const sections: { title: string; fields: { label: string; value: React.ReactNode }[] }[] = [
    {
      title: "Job",
      fields: [
        { label: "Row #", value: job.row_number ?? "-" },
        { label: "Agent", value: job.agent ?? "-" },
        { label: "Dispatcher", value: job.dispatcher ?? "-" },
        { label: "Job number", value: job.job_number ?? "-" },
        { label: "Vendor", value: job.vendor_name ?? "-" },
        { label: "Status", value: job.job_status ?? "-" },
        { label: "State", value: job.state ?? "-" },
        { label: "Customer phone", value: job.customer_phone ?? "-" },
        { label: "Notes", value: job.notes ?? "-" },
      ],
    },
    {
      title: "Financials",
      fields: [
        { label: "Job amount", value: formatCurrency(job.job_amount) },
        { label: "Vendor fee", value: formatCurrency(job.vendors_fee) },
        { label: "Refunded to client", value: formatCurrency(job.refunded_to_client) },
        { label: "Profit", value: formatCurrency(job.profit) },
        { label: "Charged via", value: job.customer_charged_via ?? "-" },
        { label: "Paid via", value: job.vendor_paid_via ?? "-" },
      ],
    },
    {
      title: "Dispatch / ETA",
      fields: [
        { label: "ETA (minutes)", value: job.eta_minutes ?? "-" },
        { label: "Dispatched at", value: formatDateTime(job.dispatched_at) },
        { label: "Dispatched / appt notes", value: job.dispatched_time ?? "-" },
        { label: "Vendor ETA (raw)", value: job.vendor_eta ?? "-" },
      ],
    },
    {
      title: "Other (from Excel upload)",
      fields: [
        { label: "Last 4 of VPC", value: job.last4_vpc ?? "-" },
        { label: "Reviewed by", value: job.reviewed_by ?? "-" },
        { label: "Call que", value: job.call_que ?? "-" },
        { label: "Brex check", value: job.brex_check ?? "-" },
        { label: "Slash check", value: job.slash_check ?? "-" },
        { label: "WC (entered by Jon)", value: job.wc_entered_by_jon ?? "-" },
        { label: "Final checked by Zumi", value: job.final_checked_by_zumi ?? "-" },
      ],
    },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/reports/${id}`} className="text-sm underline">
          ← Back to {formatDate(report.report_date)}
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Job {job.job_number ? `#${job.job_number}` : job.row_number ? `#${job.row_number}` : ""}
        </h1>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-black/60">
          {job.source === "upload" ? "From Excel upload" : "Manually entered"}
        </span>
      </div>

      <JobDetailActions job={job as Job} reportId={id} isToday={isToday} />

      {sections.map((section) => (
        <div key={section.title}>
          <h2 className="mb-2 text-sm font-semibold">{section.title}</h2>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-black/10 p-4 sm:grid-cols-2">
            {section.fields.map((f) => (
              <div key={f.label} className="flex justify-between gap-4 text-sm">
                <span className="text-black/50">{f.label}</span>
                <span className="text-right font-medium">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

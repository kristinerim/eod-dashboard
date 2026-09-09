import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getAgentNameOptions, isSupervisor } from "@/lib/profile";
import type { Lead } from "../LeadsTable";
import LeadDetailActions from "../LeadDetailActions";

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase.from("leads").select("*").eq("id", id).single();
  if (!lead) notFound();

  let jobLink: { reportId: string; jobId: string; jobNumber: string | null } | null = null;
  if (lead.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id, report_id, job_number")
      .eq("id", lead.job_id)
      .single();
    if (job) jobLink = { reportId: job.report_id, jobId: job.id, jobNumber: job.job_number };
  }

  const profile = await getCurrentProfile();
  const canDelete = isSupervisor(profile?.role);
  const agentOptions = await getAgentNameOptions();

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Lead #", value: lead.lead_number },
    { label: "Status", value: lead.status },
    { label: "Agent", value: lead.agent ?? "-" },
    { label: "Dispatcher", value: lead.dispatcher ?? "-" },
    { label: "Customer name", value: lead.customer_name ?? "-" },
    { label: "Customer phone", value: lead.customer_phone ?? "-" },
    { label: "State", value: lead.state ?? "-" },
    { label: "Source", value: lead.source ?? "-" },
    { label: "Notes", value: lead.notes ?? "-" },
    { label: "Created", value: formatDateTime(lead.created_at) },
  ];

  if (lead.status === "lost") {
    fields.push(
      { label: "Disposition", value: lead.disposition ?? "-" },
      { label: "Disposition notes", value: lead.disposition_notes ?? "-" },
      { label: "Marked lost at", value: formatDateTime(lead.disposition_at) }
    );
  }

  if (lead.status === "converted") {
    fields.push({ label: "Converted at", value: formatDateTime(lead.converted_at) });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/leads" className="text-sm underline">
          ← Back to leads
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Lead {lead.lead_number}</h1>
        {jobLink && (
          <Link
            href={`/reports/${jobLink.reportId}/jobs/${jobLink.jobId}`}
            className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200"
          >
            View job {jobLink.jobNumber ? `#${jobLink.jobNumber}` : ""} →
          </Link>
        )}
      </div>

      <LeadDetailActions
        lead={lead as Lead}
        canDelete={canDelete}
        agentOptions={agentOptions}
        currentRole={profile?.role}
        currentAgentName={profile?.agent_name}
      />

      <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-black/10 p-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="flex justify-between gap-4 text-sm">
            <span className="text-black/50">{f.label}</span>
            <span className="text-right font-medium">{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

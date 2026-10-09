import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getAgentNameOptions, isSupervisor } from "@/lib/profile";
import type { Lead } from "../LeadsTable";
import LeadDetailActions from "../LeadDetailActions";
import { QUOTE_STATUS_LABELS, type QuoteStatus } from "@/lib/constants";
import { JOB_DETAIL_FIELD_DEFS } from "@/lib/jobTypeFields";
import { composeDropOffLocation, jobTypeNeedsDropOff, stepFieldKeys } from "@/lib/intake";

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

  // A lead can now have many jobs (customers with repeat business are
  // deduped onto one lead rather than one each) — leads.job_id above is just
  // the original single-conversion back-reference; this is the full list.
  const { data: linkedJobs } = await supabase
    .from("jobs")
    .select("id, report_id, job_number, job_amount, time_converted")
    .eq("lead_id", id)
    .order("time_converted", { ascending: false, nullsFirst: false });

  const profile = await getCurrentProfile();
  const canDelete = isSupervisor(profile?.role);
  const agentOptions = await getAgentNameOptions();

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Lead #", value: lead.lead_number },
    { label: "Status", value: lead.status },
    { label: "Agent", value: lead.agent ?? "-" },
    { label: "Dispatcher", value: lead.dispatcher ?? "-" },
    { label: "Customer name", value: lead.customer_name ?? "-" },
    { label: "Company", value: lead.client_company_name ?? "-" },
    {
      label: "Customer phone",
      value: lead.customer_phone
        ? `${lead.customer_phone}${lead.phone_extension ? ` ext. ${lead.phone_extension}` : ""}`
        : "-",
    },
    ...(lead.caller_id ? [{ label: "Caller ID", value: lead.caller_id }] : []),
    { label: "Email", value: lead.email ?? "-" },
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

  const money = (n: number | null) =>
    n === null || n === undefined ? null : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const cityLine = [lead.service_street_address, lead.service_unit].filter(Boolean).join(", ");
  const cityStateZip = [lead.service_city, [lead.state, lead.service_zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const quoteTotal =
    lead.quoted_price != null || lead.additional_charges != null
      ? (lead.quoted_price ?? 0) + (lead.additional_charges ?? 0)
      : null;
  const jobType: string = lead.job_type ?? "";

  // Only rows that actually have a value are shown — the same job-type-driven
  // field config that decides what the form asked.
  const typed = (step: "vehicle" | "details") =>
    stepFieldKeys(step, jobType)
      .filter((k) => k !== "year_make_model")
      .map((k) => {
        const raw = (lead as Record<string, unknown>)[k];
        return { label: JOB_DETAIL_FIELD_DEFS[k].label, value: raw === null || raw === undefined ? null : String(raw) };
      });

  const intakeSections: { title: string; rows: { label: string; value: string | null }[] }[] = [
    {
      title: "Service",
      rows: [
        { label: "Service requested", value: lead.job_type },
        { label: "Quote status", value: QUOTE_STATUS_LABELS[lead.quote_status as QuoteStatus] ?? null },
      ],
    },
    {
      title: "Service location",
      rows: [
        { label: "Address", value: [cityLine, cityStateZip].filter(Boolean).join(", ") || null },
        { label: "Additional location details", value: lead.service_location_notes },
      ],
    },
    {
      title: "Vehicle",
      rows: [{ label: "Year / Make / Model", value: lead.year_make_model }, ...typed("vehicle")],
    },
    { title: "Service details", rows: typed("details") },
    ...(jobTypeNeedsDropOff(jobType)
      ? [
          {
            title: "Drop-off",
            rows: [
              { label: "Drop-off address", value: composeDropOffLocation(lead) },
              { label: "Drop-off instructions", value: lead.dropoff_instructions },
              { label: "Second drop-off", value: lead.second_drop_off_location },
              { label: "Distance (miles)", value: lead.distance_miles != null ? String(lead.distance_miles) : null },
            ],
          },
        ]
      : []),
    {
      title: "Quote",
      rows: [
        { label: "Quoted price", value: money(lead.quoted_price) },
        { label: "Additional charges", value: money(lead.additional_charges) },
        { label: "Total quote", value: money(quoteTotal) },
        { label: "Quote notes", value: lead.quote_notes },
      ],
    },
  ];

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

      {intakeSections.map((section) => {
        const rows = section.rows.filter((r) => r.value);
        if (rows.length === 0) return null;
        return (
          <div key={section.title}>
            <h2 className="mb-2 text-sm font-semibold">{section.title}</h2>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-black/10 p-4 sm:grid-cols-2">
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-4 text-sm">
                  <span className="text-black/50">{r.label}</span>
                  <span className="text-right font-medium">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Jobs ({linkedJobs?.length ?? 0})</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          {linkedJobs && linkedJobs.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Job #</th>
                  <th className="px-4 py-2 font-medium">Time converted</th>
                  <th className="px-4 py-2 font-medium">Job amount</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {linkedJobs.map((j) => (
                  <tr key={j.id} className="border-t border-black/10">
                    <td className="px-4 py-2">{j.job_number ?? "-"}</td>
                    <td className="px-4 py-2">{formatDateTime(j.time_converted)}</td>
                    <td className="px-4 py-2">
                      {j.job_amount != null
                        ? j.job_amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
                        : "-"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/reports/${j.report_id}/jobs/${j.id}`} className="underline">
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm text-black/50">No jobs linked to this lead yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

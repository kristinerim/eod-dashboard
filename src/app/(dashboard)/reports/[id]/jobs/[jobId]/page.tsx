import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getAgentNameOptions, isSupervisor, isFullAdmin } from "@/lib/profile";
import { needsRefund } from "@/lib/aggregate";
import type { Job } from "../../JobsTable";
import type { Invoice } from "../../../../invoices/InvoicesTable";
import { isCancelledJobStatus, type ContactedVendorRow } from "../../job-fields";
import { JOB_TYPE_FIELD_KEYS, JOB_DETAIL_FIELD_DEFS } from "@/lib/jobTypeFields";
import JobDetailActions from "./JobDetailActions";
import JobInvoicesSection from "./JobInvoicesSection";
import JobNotesSection, { type JobNote } from "./JobNotesSection";

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
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

/** Appointments with no vendor yet need dispatcher attention. */
function needsVendor(status: string | null, vendorName: string | null): boolean {
  return status?.trim().toLowerCase() === "appointment" && !vendorName;
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

  const profile = await getCurrentProfile();
  const canDelete = isSupervisor(profile?.role);
  const agentOptions = await getAgentNameOptions();
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  let leadLink: { id: string; leadNumber: string } | null = null;
  if (job.lead_id) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, lead_number")
      .eq("id", job.lead_id)
      .single();
    if (lead) leadLink = { id: lead.id, leadNumber: lead.lead_number };
  }

  const { data: invoices } = await supabase
    .from("invoices")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  const { data: contactedVendors } = await supabase
    .from("job_contacted_vendors")
    .select("id, vendor_name, phone_number, eta_given, goa")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  const { data: jobNotes } = await supabase
    .from("job_notes")
    .select("id, note, author, created_at, created_by, voided_at, voided_by_name")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  const sections: { title: string; fields: { label: string; value: React.ReactNode }[] }[] = [
    {
      title: "Client Details",
      fields: [
        {
          label: "Lead",
          value: leadLink ? (
            <Link href={`/leads/${leadLink.id}`} className="underline">
              {leadLink.leadNumber}
            </Link>
          ) : (
            "-"
          ),
        },
        { label: "Client name", value: job.customer_name ?? "-" },
        { label: "Company name", value: job.client_company_name ?? "-" },
        {
          label: "Phone number",
          value: job.customer_phone
            ? `${job.customer_phone}${job.phone_extension ? ` ext. ${job.phone_extension}` : ""}`
            : "-",
        },
        { label: "Email address", value: job.client_email ?? "-" },
      ],
    },
    {
      title: "Service Location",
      fields: [
        { label: "Street address", value: job.service_street_address ?? "-" },
        { label: "Unit / suite / apartment", value: job.service_unit ?? "-" },
        { label: "City", value: job.service_city ?? "-" },
        { label: "State", value: job.state ?? "-" },
        { label: "ZIP code", value: job.service_zip ?? "-" },
        { label: "Country", value: job.service_country ?? "-" },
        { label: "Latitude", value: job.service_latitude ?? "-" },
        { label: "Longitude", value: job.service_longitude ?? "-" },
      ],
    },
    {
      title: "Job Details",
      fields: [
        { label: "Row #", value: job.row_number ?? "-" },
        { label: "Job number", value: job.job_number ?? "-" },
        { label: "Job name", value: job.job_name ?? "-" },
        { label: "Job type", value: job.job_type ?? "-" },
        {
          label: "Vendor",
          value: needsVendor(job.job_status, job.vendor_name) ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              NO VENDOR - ACTION NEEDED
            </span>
          ) : (
            (job.vendor_name ?? "-")
          ),
        },
        { label: "Status", value: job.job_status ?? "-" },
        { label: "Sub-status", value: job.pending_completion_substatus ?? "-" },
        // Only meaningful once the job is actually cancelled — hidden the
        // rest of the time rather than showing an empty "-" for every job.
        ...(isCancelledJobStatus(job.job_status)
          ? [{ label: "Cancellation reason", value: job.cancellation_reason ?? "-" }]
          : []),
        { label: "Notes", value: job.notes ?? "-" },
        // Only the fields relevant to this job's Job Type are shown here — the
        // same config (src/lib/jobTypeFields.ts) that drives which fields
        // appear in the edit form, so the two never disagree.
        ...(JOB_TYPE_FIELD_KEYS[job.job_type ?? ""] ?? [])
          .filter((key) => key !== "service_location")
          .map((key) => ({
            label: JOB_DETAIL_FIELD_DEFS[key].label,
            value: job[key as keyof typeof job] ?? "-",
          })),
      ],
    },
    {
      title: "Schedule",
      fields: [
        { label: "Agent (assigned team member)", value: job.agent ?? "-" },
        { label: "Dispatcher", value: job.dispatcher ?? "-" },
        { label: "All-day event", value: job.is_all_day ? "Yes" : "No" },
        { label: "Start date & time", value: formatDateTime(job.schedule_start_at) },
        { label: "End date & time", value: formatDateTime(job.schedule_end_at) },
        { label: "Appointment date & time", value: formatDateTime(job.appointment_at) },
        { label: "Time converted", value: formatDateTime(job.time_converted) },
        { label: "Time dispatched", value: formatDateTime(job.time_dispatched) },
        { label: "Dispatched / appt notes", value: job.dispatched_time ?? "-" },
      ],
    },
    {
      title: "Service Provider Quote",
      fields: [
        { label: "Service amount (quoted)", value: formatCurrency(job.quoted_service_amount) },
        { label: "ETA (minutes)", value: job.eta_minutes ?? "-" },
        { label: "Vendor ETA (raw)", value: job.vendor_eta ?? "-" },
        { label: "GOA (Gone on Arrival)", value: job.goa ? "Yes" : "No" },
      ],
    },
    {
      title: "Financials & Payment",
      fields: [
        { label: "Job amount", value: formatCurrency(job.job_amount) },
        { label: "Vendor fee", value: formatCurrency(job.vendors_fee) },
        {
          label: "Refunded to client",
          value: needsRefund(job) ? (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              {job.refunded_to_client ? `${formatCurrency(job.refunded_to_client)} - ` : ""}
              REFUND NEEDED
            </span>
          ) : (
            formatCurrency(job.refunded_to_client)
          ),
        },
        { label: "Profit", value: formatCurrency(job.profit) },
        { label: "Charged via", value: job.customer_charged_via ?? "-" },
        { label: "Paid via", value: job.vendor_paid_via ?? "-" },
        { label: "Card expiry", value: job.card_expiry ?? "-" },
        { label: "Billing address", value: job.billing_address ?? "-" },
        { label: "TL quote", value: formatCurrency(job.tl_quote) },
        { label: "TL ETA (minutes)", value: job.tl_eta_minutes ?? "-" },
        { label: "Quoted by dispatcher", value: job.quoted_by_dispatcher ?? "-" },
      ],
    },
    {
      // Applies to every job, not just Excel-uploaded ones — these are the
      // same reviewed_by/call_que/brex_check/slash_check/wc_entered_by_jon/
      // final_checked_by_zumi columns on the job record, just surfaced here
      // so they're visible without opening Edit.
      title: "Verification & Admin",
      fields: [
        { label: "Reviewed by", value: job.reviewed_by ?? "-" },
        { label: "Call queue", value: job.call_que ?? "-" },
        { label: "Brex check", value: job.brex_check ?? "-" },
        { label: "Slash check", value: job.slash_check ?? "-" },
        { label: "WC (entered by Jon)", value: job.wc_entered_by_jon ?? "-" },
        { label: "Final checked by Zumi", value: job.final_checked_by_zumi ?? "-" },
        { label: "Last 4 of VPC", value: job.last4_vpc ?? "-" },
      ],
    },
  ];

  const jobDetailsIndex = sections.findIndex((s) => s.title === "Job Details");

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

      <JobDetailActions
        job={job as Job}
        reportId={id}
        canDelete={canDelete}
        agentOptions={agentOptions}
        currentRole={profile?.role}
        currentAgentName={profile?.agent_name}
        contactedVendors={(contactedVendors ?? []) as (ContactedVendorRow & { id: string })[]}
      />

      {sections.slice(0, jobDetailsIndex + 1).map((section) => (
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

      <JobNotesSection
        jobId={jobId}
        reportId={id}
        notes={(jobNotes ?? []) as JobNote[]}
        currentUserId={currentUser?.id ?? null}
        isFullAdmin={isFullAdmin(profile?.role)}
      />

      {sections.slice(jobDetailsIndex + 1).map((section) => (
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

      <div>
        <h2 className="mb-2 text-sm font-semibold">Contacted Vendors</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          {contactedVendors && contactedVendors.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Vendor name</th>
                  <th className="px-4 py-2 font-medium">Phone number</th>
                  <th className="px-4 py-2 font-medium">ETA given</th>
                  <th className="px-4 py-2 font-medium">GOA</th>
                </tr>
              </thead>
              <tbody>
                {contactedVendors.map((v) => (
                  <tr key={v.id} className="border-t border-black/10">
                    <td className="px-4 py-2">{v.vendor_name ?? "-"}</td>
                    <td className="px-4 py-2">{v.phone_number ?? "-"}</td>
                    <td className="px-4 py-2">{v.eta_given ?? "-"}</td>
                    <td className="px-4 py-2">{v.goa ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-sm text-black/50">No vendors contacted yet.</p>
          )}
        </div>
      </div>

      <JobInvoicesSection
        job={{
          id: job.id,
          job_number: job.job_number,
          customer_name: job.customer_name,
          customer_phone: job.customer_phone,
          state: job.state,
          job_amount: job.job_amount,
          notes: job.notes,
        }}
        invoices={(invoices ?? []) as Invoice[]}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPhoneDisplay } from "@/lib/vendors";
import CommunicationPanel from "@/components/communications/CommunicationPanel";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import { emailConfig } from "@/lib/email/send";
import { loadCommunications } from "@/lib/communicationsLoader";

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

function formatCurrency(n: number | null) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (!customer) notFound();

  const { data: leads } = await supabase
    .from("leads")
    .select("id, lead_number, status, job_type, quote_status, quoted_price, agent, created_at")
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  const leadIds = (leads ?? []).map((l) => l.id);
  const { data: jobs } = leadIds.length
    ? await supabase
        .from("jobs")
        .select("id, report_id, job_number, job_type, job_status, job_amount, time_converted, agent, lead_id")
        .in("lead_id", leadIds)
        .order("time_converted", { ascending: false, nullsFirst: false })
        .limit(200)
    : { data: [] };

  const communications = await loadCommunications(supabase, { kind: "customer", customerId: id });
  const phoneDigits = customer.phone ? customer.phone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1") : "";

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/customers" className="text-sm underline">
        ← All customers
      </Link>

      <div>
        <h1 className="text-lg font-semibold">{customer.name || "Unnamed customer"}</h1>
        {customer.company && <p className="text-sm text-black/60">{customer.company}</p>}
      </div>

      <div className="grid gap-x-6 gap-y-2 rounded-lg border border-black/10 p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <span className="text-black/50">Phone</span>
          <span className="font-medium">{phoneDigits ? formatPhoneDisplay(phoneDigits) : <span className="text-red-600">none saved</span>}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-black/50">Email</span>
          <span className="font-medium">{customer.email ?? <span className="text-red-600">none saved</span>}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-black/50">Customer since</span>
          <span className="font-medium">{formatDateTime(customer.created_at)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-black/50">Leads / jobs</span>
          <span className="font-medium">
            {leads?.length ?? 0} / {jobs?.length ?? 0}
          </span>
        </div>
      </div>

      <RealtimeRefresh tables={["communications"]} />
      <CommunicationPanel
        context={{ customerId: id }}
        rows={communications}
        recipients={[
          {
            id: "customer",
            label: "Customer",
            partyType: "customer",
            name: customer.name ?? "",
            email: customer.email ?? null,
            phone: phoneDigits || null,
          },
        ]}
        emailConnected={emailConfig() !== null}
        smsConnected={false}
        showLinks
        note="Everything sent to or received from this customer, across all of their leads and jobs. Each message shows the lead or job it belongs to."
      />

      <div>
        <h2 className="mb-2 text-sm font-semibold">Leads ({leads?.length ?? 0})</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Lead #</th>
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Quote</th>
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {(leads ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-black/50">
                    No leads.
                  </td>
                </tr>
              )}
              {(leads ?? []).map((l) => (
                <tr key={l.id} className="border-t border-black/10">
                  <td className="px-4 py-2">
                    <Link href={`/leads/${l.id}`} className="underline">
                      {l.lead_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{l.job_type ?? "-"}</td>
                  <td className="px-4 py-2 capitalize">{l.status}</td>
                  <td className="px-4 py-2">{formatCurrency(l.quoted_price)}</td>
                  <td className="px-4 py-2">{l.agent ?? "-"}</td>
                  <td className="px-4 py-2">{formatDateTime(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Jobs ({jobs?.length ?? 0})</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Job #</th>
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Converted</th>
              </tr>
            </thead>
            <tbody>
              {(jobs ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-black/50">
                    No jobs.
                  </td>
                </tr>
              )}
              {(jobs ?? []).map((j) => (
                <tr key={j.id} className="border-t border-black/10">
                  <td className="px-4 py-2">
                    <Link href={`/reports/${j.report_id}/jobs/${j.id}`} className="underline">
                      {j.job_number ?? "(no number yet)"}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{j.job_type ?? "-"}</td>
                  <td className="px-4 py-2">{j.job_status ?? "-"}</td>
                  <td className="px-4 py-2">{formatCurrency(j.job_amount)}</td>
                  <td className="px-4 py-2">{j.agent ?? "-"}</td>
                  <td className="px-4 py-2">{formatDateTime(j.time_converted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

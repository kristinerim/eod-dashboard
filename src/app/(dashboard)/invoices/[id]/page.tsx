import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isSupervisor } from "@/lib/profile";
import type { Invoice } from "../InvoicesTable";
import { InvoiceStatusBadge } from "../InvoicesTable";
import InvoiceStatusActions from "../InvoiceStatusActions";

function formatCurrency(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).single();
  if (!invoice) notFound();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, report_id, job_number, lead_id")
    .eq("id", invoice.job_id)
    .single();

  const profile = await getCurrentProfile();
  const canDelete = isSupervisor(profile?.role);

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: "Invoice #", value: invoice.invoice_number },
    { label: "Status", value: <InvoiceStatusBadge status={invoice.status} /> },
    { label: "Customer name", value: invoice.customer_name ?? "-" },
    { label: "Customer phone", value: invoice.customer_phone ?? "-" },
    { label: "State", value: invoice.state ?? "-" },
    { label: "Amount", value: formatCurrency(invoice.amount) },
    { label: "Amount paid", value: formatCurrency(invoice.amount_paid) },
    { label: "Service details", value: invoice.service_details ?? "-" },
    { label: "Notes", value: invoice.notes ?? "-" },
    { label: "Created", value: formatDateTime(invoice.created_at) },
    { label: "Sent", value: formatDateTime(invoice.sent_at) },
    { label: "Paid", value: formatDateTime(invoice.paid_at) },
    { label: "Voided", value: formatDateTime(invoice.voided_at) },
    { label: "Refunded", value: formatDateTime(invoice.refunded_at) },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/invoices" className="text-sm underline">
          ← Back to invoices
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Invoice {invoice.invoice_number}</h1>
        {job && (
          <Link href={`/reports/${job.report_id}/jobs/${job.id}`} className="text-sm underline">
            View job {job.job_number ? `#${job.job_number}` : ""} →
          </Link>
        )}
      </div>

      <InvoiceStatusActions invoice={invoice as Invoice} canDelete={canDelete} />

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

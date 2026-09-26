import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isSupervisor } from "@/lib/profile";
import type { Invoice } from "../InvoicesTable";
import type { InvoiceLineItemRow } from "../invoice-actions";
import { buildInvoiceViewModel, type InvoiceViewModel } from "../invoice-document";
import InvoiceDocument from "../InvoiceDocument";
import InvoiceStatusActions from "../InvoiceStatusActions";
import InvoiceSignatureActions from "../InvoiceSignatureActions";
import SignatureDisplay from "../SignatureDisplay";
import PrintInvoiceButton from "./PrintInvoiceButton";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("invoices").select("*").eq("id", id).single();
  if (!invoice) notFound();

  const { data: job } = await supabase.from("jobs").select("*").eq("id", invoice.job_id).single();

  const { data: rawLineItems } = await supabase
    .from("invoice_line_items")
    .select("description, quantity, unit_price, amount")
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });

  const profile = await getCurrentProfile();
  const canDelete = isSupervisor(profile?.role);

  // Invoices created before line items existed have none on file — fall back
  // to a single synthesized charge so old invoices still render a table.
  const lineItems: InvoiceLineItemRow[] =
    rawLineItems && rawLineItems.length > 0
      ? rawLineItems
      : invoice.amount !== null
        ? [
            {
              description: invoice.service_details ?? job?.job_type ?? "Service",
              quantity: 1,
              unit_price: invoice.amount,
              amount: invoice.amount,
            },
          ]
        : [];

  // Once signed, the document is frozen — a later edit to the job must never
  // silently change what the customer already agreed to. Amount paid /
  // refund stay live regardless, since payment tracking continues after signing.
  const viewModel: InvoiceViewModel =
    invoice.signature_status === "Signed" && invoice.signed_snapshot
      ? (invoice.signed_snapshot as InvoiceViewModel)
      : buildInvoiceViewModel({ invoice, job, lineItems });

  const amountPaid = invoice.amount_paid ?? 0;
  const refund = (job?.refunded_to_client as number | null) ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 print:max-w-none">
      <div className="space-y-3 print:hidden">
        <Link href="/invoices" className="text-sm underline">
          ← Back to invoices
        </Link>

        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Invoice {invoice.invoice_number}</h1>
          <div className="flex items-center gap-3">
            {job && (
              <Link href={`/reports/${job.report_id}/jobs/${job.id}`} className="text-sm underline">
                View job {job.job_number ? `#${job.job_number}` : ""} →
              </Link>
            )}
            <PrintInvoiceButton />
          </div>
        </div>

        <InvoiceStatusActions invoice={invoice as Invoice} lineItems={lineItems} canDelete={canDelete} />
        <InvoiceSignatureActions invoice={invoice as Invoice} />
      </div>

      <InvoiceDocument
        invoiceNumber={invoice.invoice_number}
        viewModel={viewModel}
        amountPaid={amountPaid}
        refund={refund}
        signatureBlock={
          <SignatureDisplay
            signedAt={invoice.signed_at}
            signedName={invoice.signed_name}
            signatureImage={invoice.signature_image}
          />
        }
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildInvoiceViewModel, type InvoiceViewModel } from "@/app/(dashboard)/invoices/invoice-document";
import InvoiceDocument from "@/app/(dashboard)/invoices/InvoiceDocument";
import SignatureDisplay from "@/app/(dashboard)/invoices/SignatureDisplay";
import type { InvoiceLineItemRow } from "@/app/(dashboard)/invoices/invoice-actions";
import SignaturePadForm from "./SignaturePadForm";

// Public, unauthenticated page — see src/lib/supabase/middleware.ts for the
// auth-gate exemption and src/lib/supabase/admin.ts for why this reads via
// the service-role client instead of the request-scoped one.
export default async function SignInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: invoice } = await supabase.from("invoices").select("*").eq("signature_token", token).single();
  if (!invoice) notFound();

  const { data: job } = await supabase.from("jobs").select("*").eq("id", invoice.job_id).single();

  const { data: rawLineItems } = await supabase
    .from("invoice_line_items")
    .select("description, quantity, unit_price, amount")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true });

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

  const isSigned = invoice.signature_status === "Signed";
  const viewModel: InvoiceViewModel =
    isSigned && invoice.signed_snapshot
      ? (invoice.signed_snapshot as InvoiceViewModel)
      : buildInvoiceViewModel({ invoice, job, lineItems });

  const amountPaid = invoice.amount_paid ?? 0;
  const refund = (job?.refunded_to_client as number | null) ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 print:max-w-none print:p-0">
      <div className="text-center print:hidden">
        <h1 className="text-lg font-semibold">Invoice {invoice.invoice_number}</h1>
        <p className="text-sm text-black/60">
          {isSigned ? "This invoice has been signed." : "Please review the details below, then sign at the bottom."}
        </p>
      </div>

      <InvoiceDocument
        invoiceNumber={invoice.invoice_number}
        viewModel={viewModel}
        amountPaid={amountPaid}
        refund={refund}
        signatureBlock={
          isSigned ? (
            <SignatureDisplay
              signedAt={invoice.signed_at}
              signedName={invoice.signed_name}
              signatureImage={invoice.signature_image}
            />
          ) : (
            <SignaturePadForm token={token} defaultName={viewModel.customerName ?? ""} />
          )
        }
      />
    </div>
  );
}

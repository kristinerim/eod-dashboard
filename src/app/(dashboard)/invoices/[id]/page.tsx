import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isSupervisor } from "@/lib/profile";
import { COMPANY_NAME, COMPANY_PHONE } from "@/lib/constants";
import { JOB_TYPE_FIELD_KEYS, JOB_DETAIL_FIELD_DEFS, type JobDetailFieldKey } from "@/lib/jobTypeFields";
import type { Invoice } from "../InvoicesTable";
import type { InvoiceLineItemRow } from "../invoice-actions";
import InvoiceStatusActions from "../InvoiceStatusActions";
import PrintInvoiceButton from "./PrintInvoiceButton";

function formatCurrency(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatAddress(job: any): string | null {
  const line1 = [job?.service_street_address, job?.service_unit].filter(Boolean).join(", ");
  const cityStateZip = [job?.service_city, [job?.state, job?.service_zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const full = [line1, cityStateZip].filter(Boolean).join(", ");
  return full || null;
}

// Fields shown in Service Information beyond the always-present Service
// Requested / Amount / Problem / Service Location — only the ones that apply
// to this job's Job Type (per the dynamic Job Details config) and that
// actually have a value are rendered, per the "no blank fields" requirement.
const SERVICE_EXTRA_KEYS: JobDetailFieldKey[] = [
  "drop_off_location",
  "second_drop_off_location",
  "distance_miles",
  "number_of_gallons",
  "fuel_type",
  "tire_size",
  "trailer_type",
  "loaded_with",
  "trailer_weight",
  "trailer_length",
  "trailer_width",
  "trailer_height",
];

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

  const subtotal = lineItems.reduce((sum, r) => sum + r.amount, 0);
  const tax = invoice.tax_amount as number | null;
  const total = subtotal + (tax ?? 0);
  const amountPaid = invoice.amount_paid ?? 0;
  const refund = (job?.refunded_to_client as number | null) ?? 0;
  const balanceDue = total - amountPaid - refund;

  // Customer/vehicle/service info reads live off the linked job rather than
  // the invoice's own copied snapshot columns, so an edit made on the job
  // shows up on the invoice automatically (see Customer Invoice redesign).
  const customerName = job?.customer_name ?? invoice.customer_name;
  const customerPhone = job?.customer_phone ?? invoice.customer_phone;
  const customerEmail = job?.client_email ?? null;
  const billingAddress = job?.customer_billing_address ?? job?.billing_address ?? null;
  const serviceAddress = formatAddress(job);

  const typeFieldKeys: JobDetailFieldKey[] = (job?.job_type && JOB_TYPE_FIELD_KEYS[job.job_type]) || [];
  const hasKey = (k: JobDetailFieldKey) => typeFieldKeys.includes(k);
  const hasSecondDropOff = hasKey("second_drop_off_location") && !!job?.second_drop_off_location;

  const vehicleRows = [
    job?.year_make_model ? { label: "Year / Make / Model", value: job.year_make_model as string } : null,
    job?.vin_or_lpn ? { label: "VIN or License Plate #", value: job.vin_or_lpn as string } : null,
    job?.color ? { label: "Color", value: job.color as string } : null,
  ].filter((r): r is { label: string; value: string } => r !== null);

  const serviceRows: { label: string; value: string }[] = [
    { label: "Service Requested", value: job?.job_type ?? job?.job_name ?? "-" },
    { label: "Service Amount", value: formatCurrency(total) },
    ...(job?.issue ? [{ label: "Problem / Issue", value: job.issue as string }] : []),
    ...(serviceAddress ? [{ label: "Service Location", value: serviceAddress }] : []),
    ...SERVICE_EXTRA_KEYS.flatMap((key) => {
      if (!hasKey(key)) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (job as any)?.[key];
      if (raw === null || raw === undefined || raw === "") return [];
      const value = key === "distance_miles" ? `${raw} mi` : String(raw);
      const label =
        key === "drop_off_location" && hasSecondDropOff ? "First Drop-Off Location" : JOB_DETAIL_FIELD_DEFS[key].label;
      return [{ label, value }];
    }),
  ];

  const vehicleDescriptor = job?.year_make_model || "vehicle";
  const last4 = job?.customer_card_last4 ? `••••${job.customer_card_last4}` : "____";

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
      </div>

      {/* The printable invoice document */}
      <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <div className="flex items-start justify-between bg-[#4f7080] px-6 py-5 text-white">
          <div className="text-3xl font-bold uppercase tracking-tight">Invoice #{invoice.invoice_number}</div>
          <div className="text-right text-sm leading-relaxed">
            <div className="font-semibold">{COMPANY_NAME}</div>
            <div>{COMPANY_PHONE}</div>
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 px-6 py-5">
          <div className="space-y-0.5 text-sm">
            <div className="mb-1 font-bold">Billed to:</div>
            <div>NAME: {customerName ?? "-"}</div>
            <div>PHONE: {customerPhone ?? "-"}</div>
            <div>EMAIL: {customerEmail ?? "-"}</div>
            <div>BILLING ADDRESS: {billingAddress ?? "-"}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs font-semibold text-black/60">Invoice Total</div>
            <div className="text-2xl font-bold text-[#4f7080]">{formatCurrency(total)}</div>
            <div className="mt-2 text-xs font-semibold text-black/60">Balance Due</div>
            <div className="text-2xl font-bold text-[#4f7080]">{formatCurrency(balanceDue)}</div>
          </div>
        </div>

        <div className="px-6 pb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-black/5 text-left">
                <th className="px-2 py-2 font-semibold">Description</th>
                <th className="px-2 py-2 text-right font-semibold">QTY</th>
                <th className="px-2 py-2 text-right font-semibold">Price</th>
                <th className="px-2 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item, i) => (
                <tr key={i} className={i % 2 === 1 ? "bg-black/[0.03]" : ""}>
                  <td className="px-2 py-2 font-medium">{item.description}</td>
                  <td className="px-2 py-2 text-right">{item.quantity.toFixed(2)}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(item.unit_price)}</td>
                  <td className="px-2 py-2 text-right">{formatCurrency(item.amount)}</td>
                </tr>
              ))}
              {lineItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-2 py-4 text-center text-black/50">
                    No charges on this invoice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="ml-auto mt-3 w-64 space-y-1 text-sm">
            <TotalsRow label="Sub total" value={subtotal} />
            {tax !== null && tax !== undefined && <TotalsRow label="Tax" value={tax} />}
            <TotalsRow label="Total" value={total} bold />
            <TotalsRow label="Amount Paid" value={amountPaid} />
            {refund > 0 && <TotalsRow label="Refund" value={refund} />}
            <TotalsRow label="Balance Due" value={balanceDue} bold />
          </div>
        </div>

        {vehicleRows.length > 0 && <InfoSection title="Vehicle Information" rows={vehicleRows} />}
        <InfoSection title="Service Information" rows={serviceRows} />

        <div className="break-inside-avoid px-6 py-6">
          <h2 className="mb-3 text-lg font-bold">Authorization and Acknowledgment</h2>
          <div className="space-y-3 text-sm leading-relaxed text-black/80">
            <p>
              By signing this document, I, {customerName ?? "the customer"}, authorize {COMPANY_NAME} to charge my
              debit/credit card ending {last4}, with the service amount of {formatCurrency(total)} for the Service of
              my {vehicleDescriptor}.
            </p>
            <p>
              By proceeding, I acknowledge that this purchase is final and authorize the service. I understand that
              additional charges may apply with my approval and that the estimated time of arrival (ETA) is subject
              to change. No refunds will be issued once the service is completed. Cancellations after confirmation
              may incur a fee of 50%–100% of the quoted amount, including GOA (Gone on Arrival) or delays beyond our
              control.
            </p>
            <p>
              I further acknowledge that all services are performed by independently owned and operated service
              providers assigned through our dispatch network of independent service providers. {COMPANY_NAME}{" "}
              provides dispatch, coordination, and payment facilitation services, which constitute the services
              covered by the quoted service fees. The assigned service provider is solely responsible for service
              execution, vehicle handling, and operational safety.
            </p>
            <p>By signing, I confirm that I have read, understood, and agreed to these terms.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TotalsRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span>{formatCurrency(value)}</span>
    </div>
  );
}

function InfoSection({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="break-inside-avoid border-t border-black/10">
      <div className="bg-[#4f7080] px-6 py-1.5 text-sm font-bold uppercase text-white">{title}</div>
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`grid grid-cols-[1fr_2fr] text-sm ${i % 2 === 1 ? "bg-black/[0.03]" : ""}`}
        >
          <div className="border-b border-r border-black/10 px-6 py-1.5 font-medium">{row.label}</div>
          <div className="border-b border-black/10 px-4 py-1.5">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

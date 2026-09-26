import { COMPANY_NAME, COMPANY_PHONE } from "@/lib/constants";
import { formatCurrency, type InvoiceViewModel, type InvoiceInfoRow } from "./invoice-document";

export default function InvoiceDocument({
  invoiceNumber,
  viewModel,
  amountPaid,
  refund,
  signatureBlock,
}: {
  invoiceNumber: string;
  viewModel: InvoiceViewModel;
  amountPaid: number;
  refund: number;
  signatureBlock: React.ReactNode;
}) {
  const { lineItems, subtotal, tax, total, vehicleRows, serviceRows, authorization } = viewModel;
  const balanceDue = total - amountPaid - refund;

  return (
    <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <div className="flex items-start justify-between bg-[#4f7080] px-6 py-5 text-white">
        <div className="text-3xl font-bold uppercase tracking-tight">Invoice #{invoiceNumber}</div>
        <div className="text-right text-sm leading-relaxed">
          <div className="font-semibold">{COMPANY_NAME}</div>
          <div>{COMPANY_PHONE}</div>
        </div>
      </div>

      <div className="flex items-start justify-between gap-6 px-6 py-5">
        <div className="space-y-0.5 text-sm">
          <div className="mb-1 font-bold">Billed to:</div>
          <div>NAME: {viewModel.customerName ?? "-"}</div>
          <div>PHONE: {viewModel.customerPhone ?? "-"}</div>
          <div>EMAIL: {viewModel.customerEmail ?? "-"}</div>
          <div>BILLING ADDRESS: {viewModel.billingAddress ?? "-"}</div>
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

      {/* Compact on purpose — the terms need to be available, not prominent. */}
      <div className="break-inside-avoid px-6 py-5">
        <h2 className="mb-2 text-sm font-semibold">Authorization and Acknowledgment</h2>
        <div className="space-y-2 text-[11px] leading-snug text-black/60">
          <p>
            By signing this document, I, {authorization.customerName}, authorize {COMPANY_NAME} to charge my
            debit/credit card ending {authorization.last4}, with the service amount of{" "}
            {authorization.serviceAmountFormatted} for the Service of my {authorization.vehicleDescriptor}.
          </p>
          <p>
            By proceeding, I acknowledge that this purchase is final and authorize the service. I understand that
            additional charges may apply with my approval and that the estimated time of arrival (ETA) is subject to
            change. No refunds will be issued once the service is completed. Cancellations after confirmation may
            incur a fee of 50%–100% of the quoted amount, including GOA (Gone on Arrival) or delays beyond our
            control.
          </p>
          <p>
            I further acknowledge that all services are performed by independently owned and operated service
            providers assigned through our dispatch network of independent service providers. {COMPANY_NAME} provides
            dispatch, coordination, and payment facilitation services, which constitute the services covered by the
            quoted service fees. The assigned service provider is solely responsible for service execution, vehicle
            handling, and operational safety.
          </p>
          <p>By signing, I confirm that I have read, understood, and agreed to these terms.</p>
        </div>

        {signatureBlock}
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

function InfoSection({ title, rows }: { title: string; rows: InvoiceInfoRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="break-inside-avoid border-t border-black/10">
      <div className="bg-[#4f7080] px-6 py-1.5 text-sm font-bold uppercase text-white">{title}</div>
      {rows.map((row, i) => (
        <div key={row.label} className={`grid grid-cols-[1fr_2fr] text-sm ${i % 2 === 1 ? "bg-black/[0.03]" : ""}`}>
          <div className="border-b border-r border-black/10 px-6 py-1.5 font-medium">{row.label}</div>
          <div className="border-b border-black/10 px-4 py-1.5">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

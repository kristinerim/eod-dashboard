"use client";

import { useState } from "react";
import Link from "next/link";
import InvoiceForm from "../../../../invoices/InvoiceForm";
import { InvoiceStatusBadge, SignatureStatusBadge, type Invoice } from "../../../../invoices/InvoicesTable";

function formatCurrency(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

interface JobDefaults {
  id: string;
  job_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  state: string | null;
  job_amount: number | null;
  notes: string | null;
  job_type: string | null;
  job_name: string | null;
}

export default function JobInvoicesSection({
  job,
  invoices,
}: {
  job: JobDefaults;
  invoices: Invoice[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Invoices</h2>
        <button
          onClick={() => setCreating(true)}
          type="button"
          className="rounded bg-black px-3 py-1 text-xs font-medium text-white"
        >
          + Create invoice
        </button>
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-black/50">No invoices yet for this job.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Invoice #</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Paid</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Signature</th>
                <th className="px-4 py-2 font-medium">Signed</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                  <td className="px-4 py-2">
                    <Link href={`/invoices/${inv.id}`} className="underline">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{formatCurrency(inv.amount)}</td>
                  <td className="px-4 py-2">{formatCurrency(inv.amount_paid)}</td>
                  <td className="px-4 py-2">
                    <InvoiceStatusBadge status={inv.status} />
                  </td>
                  <td className="px-4 py-2">
                    <SignatureStatusBadge status={inv.signature_status} />
                  </td>
                  <td className="px-4 py-2">
                    {inv.signature_status === "Signed" ? (
                      <>
                        {inv.signed_name}
                        <br />
                        <span className="text-xs text-black/50">{formatDateTime(inv.signed_at)}</span>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <InvoiceForm job={job} onClose={() => setCreating(false)} />}
    </div>
  );
}

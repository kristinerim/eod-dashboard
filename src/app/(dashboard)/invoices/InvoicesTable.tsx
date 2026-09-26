"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface Invoice {
  id: string;
  invoice_number: string;
  job_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  job_number: string | null;
  state: string | null;
  service_details: string | null;
  amount: number | null;
  tax_amount: number | null;
  amount_paid: number;
  status: "Draft" | "Sent" | "Paid" | "Partially Paid" | "Voided" | "Refunded";
  notes: string | null;
  created_at: string;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  refunded_at: string | null;
  signature_token: string;
  signature_status: "Not Sent" | "Sent" | "Signed";
  signature_sent_at: string | null;
  signed_at: string | null;
  signed_name: string | null;
  signature_image: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signed_snapshot: any;
}

function formatCurrency(n: number | null) {
  if (n === null) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

const STATUS_STYLES: Record<Invoice["status"], string> = {
  Draft: "bg-black/10 text-black/60",
  Sent: "bg-blue-100 text-blue-700",
  Paid: "bg-green-100 text-green-700",
  "Partially Paid": "bg-amber-100 text-amber-700",
  Voided: "bg-black/10 text-black/40 line-through",
  Refunded: "bg-purple-100 text-purple-700",
};

export function InvoiceStatusBadge({ status }: { status: Invoice["status"] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

const SIGNATURE_STATUS_STYLES: Record<Invoice["signature_status"], string> = {
  "Not Sent": "bg-black/10 text-black/60",
  Sent: "bg-blue-100 text-blue-700",
  Signed: "bg-green-100 text-green-700",
};

export function SignatureStatusBadge({ status }: { status: Invoice["signature_status"] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SIGNATURE_STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export default function InvoicesTable({
  invoices,
  reportIdByJobId,
}: {
  invoices: Invoice[];
  reportIdByJobId?: Record<string, string>;
}) {
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(
    () => invoices.filter((i) => !statusFilter || i.status === statusFilter),
    [invoices, statusFilter]
  );

  const statuses = useMemo(() => Array.from(new Set(invoices.map((i) => i.status))), [invoices]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-black/20 px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-black/50">
          {filtered.length} of {invoices.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Invoice #</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Job #</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Customer</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Amount</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Paid</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Status</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Signature</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => (
              <tr key={inv.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                <td className="whitespace-nowrap px-3 py-2">
                  <Link href={`/invoices/${inv.id}`} className="font-medium underline">
                    {inv.invoice_number}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {reportIdByJobId?.[inv.job_id] ? (
                    <Link
                      href={`/reports/${reportIdByJobId[inv.job_id]}/jobs/${inv.job_id}`}
                      className="underline"
                    >
                      {inv.job_number ?? "-"}
                    </Link>
                  ) : (
                    (inv.job_number ?? "-")
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2">{inv.customer_name ?? "-"}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatCurrency(inv.amount)}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatCurrency(inv.amount_paid)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <InvoiceStatusBadge status={inv.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <SignatureStatusBadge status={inv.signature_status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(inv.created_at)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-black/50">
                  No invoices match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setInvoiceStatus, recordInvoicePayment, deleteInvoice } from "./invoice-actions";
import InvoiceForm from "./InvoiceForm";
import type { Invoice } from "./InvoicesTable";

export default function InvoiceStatusActions({
  invoice,
  canDelete,
}: {
  invoice: Invoice;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function handleSetStatus(status: string) {
    setError(null);
    startTransition(async () => {
      const result = await setInvoiceStatus(invoice.id, status);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleRecordPayment() {
    const remaining = invoice.amount !== null ? invoice.amount - invoice.amount_paid : null;
    const input = prompt(
      `Payment amount to record now ($)${remaining !== null ? ` (${remaining.toFixed(2)} remaining)` : ""}:`,
      ""
    );
    if (input === null) return;
    const amount = Number(input);
    if (Number.isNaN(amount) || amount <= 0) return setError("Enter a valid payment amount.");
    setError(null);
    startTransition(async () => {
      const result = await recordInvoicePayment(invoice.id, amount);
      if ("error" in result) return setError(result.error);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("Delete this invoice? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteInvoice(invoice.id);
      if ("error" in result) return setError(result.error);
      router.push("/invoices");
    });
  }

  const isTerminal = invoice.status === "Voided" || invoice.status === "Refunded";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {invoice.status === "Draft" && (
          <>
            <button
              onClick={() => setEditing(true)}
              className="rounded border border-black/20 px-4 py-1.5 text-sm"
              type="button"
            >
              Edit
            </button>
            <button
              onClick={() => handleSetStatus("Sent")}
              disabled={isPending}
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              type="button"
            >
              Mark sent
            </button>
          </>
        )}
        {(invoice.status === "Sent" || invoice.status === "Partially Paid") && (
          <button
            onClick={handleRecordPayment}
            disabled={isPending}
            className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            type="button"
          >
            Record payment
          </button>
        )}
        {!isTerminal && invoice.status !== "Paid" && (
          <button
            onClick={() => handleSetStatus("Voided")}
            disabled={isPending}
            className="rounded border border-black/20 px-4 py-1.5 text-sm disabled:opacity-50"
            type="button"
          >
            Void
          </button>
        )}
        {(invoice.status === "Paid" || invoice.status === "Partially Paid") && (
          <button
            onClick={() => handleSetStatus("Refunded")}
            disabled={isPending}
            className="rounded border border-black/20 px-4 py-1.5 text-sm disabled:opacity-50"
            type="button"
          >
            Refund
          </button>
        )}
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="rounded border border-red-300 px-4 py-1.5 text-sm text-red-600 disabled:opacity-50"
            type="button"
          >
            Delete
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {editing && <InvoiceForm invoice={invoice} onClose={() => setEditing(false)} />}
    </div>
  );
}

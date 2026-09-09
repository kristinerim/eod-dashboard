"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoice, updateInvoice } from "./invoice-actions";
import type { Invoice } from "./InvoicesTable";

interface JobDefaults {
  id: string;
  job_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  state: string | null;
  job_amount: number | null;
  notes: string | null;
}

interface Props {
  invoice?: Invoice;
  job?: JobDefaults;
  onClose: () => void;
  onCreated?: (invoiceId: string) => void;
}

export default function InvoiceForm({ invoice, job, onClose, onCreated }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = invoice
        ? await updateInvoice(invoice.id, formData)
        : await createInvoice(job!.id, formData);

      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
      if (!invoice && "id" in result && result.id && onCreated) onCreated(result.id);
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{invoice ? "Edit invoice" : "Create invoice"}</h2>
          <button onClick={onClose} className="text-black/50 hover:text-black" type="button">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!invoice && (
            <p className="text-xs text-black/50">
              Customer and job details below carry over from the job — adjust anything before
              saving.
            </p>
          )}

          <Field label="Customer name">
            <input
              name="customer_name"
              defaultValue={invoice?.customer_name ?? job?.customer_name ?? ""}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer phone">
              <input
                name="customer_phone"
                defaultValue={invoice?.customer_phone ?? job?.customer_phone ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="State">
              <input
                name="state"
                defaultValue={invoice?.state ?? job?.state ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
          </div>

          <Field label="Job #">
            <div className="flex h-[34px] items-center rounded border border-black/10 bg-black/5 px-2 text-sm">
              {invoice?.job_number ?? job?.job_number ?? "-"}
            </div>
          </Field>

          <Field label="Amount (required)">
            <input
              name="amount"
              type="number"
              step="0.01"
              required
              defaultValue={invoice?.amount?.toString() ?? job?.job_amount?.toString() ?? ""}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Service details">
            <textarea
              name="service_details"
              defaultValue={invoice?.service_details ?? job?.notes ?? ""}
              rows={3}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          <Field label="Notes">
            <textarea
              name="notes"
              defaultValue={invoice?.notes ?? ""}
              rows={2}
              className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-black/20 px-4 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-black/60">{label}</span>
      {children}
    </label>
  );
}

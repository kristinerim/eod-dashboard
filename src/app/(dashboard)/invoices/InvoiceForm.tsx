"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoice, updateInvoice, type InvoiceLineItemRow } from "./invoice-actions";
import type { Invoice } from "./InvoicesTable";

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

interface Props {
  invoice?: Invoice;
  job?: JobDefaults;
  lineItems?: InvoiceLineItemRow[];
  onClose: () => void;
  onCreated?: (invoiceId: string) => void;
}

type LineItemRow = InvoiceLineItemRow & { id: string };

function newRowId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
}

function defaultLineItems(invoice: Invoice | undefined, job: JobDefaults | undefined): LineItemRow[] {
  if (invoice) return [];
  const description = job?.job_type ?? job?.job_name ?? "Service";
  const unit_price = job?.job_amount ?? 0;
  return [{ id: newRowId(), description, quantity: 1, unit_price, amount: unit_price }];
}

export default function InvoiceForm({ invoice, job, lineItems, onClose, onCreated }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<LineItemRow[]>(
    lineItems && lineItems.length > 0
      ? lineItems.map((r) => ({ ...r, id: newRowId() }))
      : defaultLineItems(invoice, job)
  );

  const subtotal = rows.reduce((sum, r) => sum + r.amount, 0);

  function addRow() {
    setRows((rs) => [...rs, { id: newRowId(), description: "", quantity: 1, unit_price: 0, amount: 0 }]);
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<LineItemRow>) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        next.amount = Math.round(next.quantity * next.unit_price * 100) / 100;
        return next;
      })
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (rows.length === 0 || rows.every((r) => !r.description.trim())) {
      setError("Add at least one charge.");
      return;
    }

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
          <input type="hidden" name="line_items_json" value={JSON.stringify(rows)} />
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

          <div className="space-y-2">
            <span className="text-xs font-medium text-black/60">Charges</span>
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.id} className="grid grid-cols-12 items-end gap-2 rounded border border-black/10 p-2">
                  <div className="col-span-6">
                    <Field label="Description">
                      <input
                        value={row.description}
                        onChange={(e) => updateRow(row.id, { description: e.target.value })}
                        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Qty">
                      <input
                        type="number"
                        step="any"
                        value={row.quantity}
                        onChange={(e) => updateRow(row.id, { quantity: Number(e.target.value) || 0 })}
                        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="col-span-3">
                    <Field label="Price">
                      <input
                        type="number"
                        step="0.01"
                        value={row.unit_price}
                        onChange={(e) => updateRow(row.id, { unit_price: Number(e.target.value) || 0 })}
                        className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
                      />
                    </Field>
                  </div>
                  <div className="col-span-1">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="h-[34px] w-full rounded border border-black/20 text-xs text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="rounded border border-black/20 px-3 py-1.5 text-xs"
            >
              + Add charge
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Subtotal">
              <div className="flex h-[34px] items-center rounded border border-black/10 bg-black/5 px-2 text-sm">
                {subtotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}
              </div>
            </Field>
            <Field label="Tax (optional)">
              <input
                name="tax_amount"
                type="number"
                step="0.01"
                defaultValue={invoice?.tax_amount?.toString() ?? ""}
                className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
              />
            </Field>
          </div>

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

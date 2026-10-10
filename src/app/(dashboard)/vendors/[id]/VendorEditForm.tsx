"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_CATEGORIES } from "@/lib/vendorImport/normalize";
import { SERVICE_LABELS, formatPhoneDisplay, type Vendor } from "@/lib/vendors";
import { updateVendor } from "../vendor-actions";

const inputCls = "w-full rounded border border-black/20 px-2 py-1.5 text-sm";

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className ?? ""}`}>
      <span className="text-xs font-medium text-black/60">{label}</span>
      {children}
    </label>
  );
}

// Any team member can fill in vendor details as they learn them. The tier is
// deliberately not here — it has its own, restricted control.
export default function VendorEditForm({ vendor }: { vendor: Vendor }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateVendor(vendor.id, formData);
      if ("error" in result) return setError(result.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-lg border border-black/10 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vendor name">
          <input name="name" defaultValue={vendor.name} className={inputCls} />
        </Field>
        <Field label="Contact name">
          <input name="contact_name" defaultValue={vendor.contact_name ?? ""} className={inputCls} />
        </Field>
        <Field label="Phone">
          <input name="phone" inputMode="tel" defaultValue={formatPhoneDisplay(vendor.phone)} className={inputCls} />
        </Field>
        <Field label="Secondary phone">
          <input
            name="secondary_phone"
            inputMode="tel"
            defaultValue={formatPhoneDisplay(vendor.secondary_phone)}
            className={inputCls}
          />
        </Field>
        <Field label="Email">
          <input name="email" type="email" defaultValue={vendor.email ?? ""} className={inputCls} />
        </Field>
        <Field label="Secondary email">
          <input name="secondary_email" type="email" defaultValue={vendor.secondary_email ?? ""} className={inputCls} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <input name="address" defaultValue={vendor.address ?? ""} className={inputCls} />
        </Field>
        <Field label="State">
          <input name="state" maxLength={2} defaultValue={vendor.state ?? ""} className={inputCls} />
        </Field>
        <Field label="Equipment">
          <input name="equipment" defaultValue={vendor.equipment ?? ""} className={inputCls} />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-black/60">Services offered</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {SERVICE_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="service_categories"
                value={c}
                defaultChecked={vendor.service_categories.includes(c)}
              />
              {SERVICE_LABELS[c]}
            </label>
          ))}
        </div>
        {vendor.service_categories.length === 0 && (
          <p className="text-xs text-black/50">
            Services not listed yet. Original wording from the map: {vendor.services_original ?? "none"}
          </p>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="heavy_duty_capable" defaultChecked={vendor.heavy_duty_capable} />
          Heavy-duty capable
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="heavy_duty_only" defaultChecked={vendor.heavy_duty_only} />
          Heavy-duty ONLY
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" defaultChecked={vendor.is_active} />
          Active
        </label>
      </div>

      <Field label="Notes">
        <textarea name="notes" rows={3} defaultValue={vendor.notes ?? ""} className={inputCls} />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">Saved.</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save details"}
      </button>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createVendor } from "./vendor-actions";

const inputCls = "w-full rounded border border-black/20 px-2 py-1.5 text-sm";

export default function AddVendorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createVendor(formData);
      if ("error" in result) return setError(result.error);
      router.push(`/vendors/${result.id}`);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white"
      >
        + Add vendor
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add vendor</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-black/50 hover:text-black">
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3" noValidate>
              <p className="text-xs text-black/50">
                New vendors start as Unclassified (held out of recommendations) until a team leader sets a tier.
              </p>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-black/60">Vendor name</span>
                <input name="name" className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-black/60">Phone</span>
                  <input name="phone" inputMode="tel" className={inputCls} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-black/60">State</span>
                  <input name="state" maxLength={2} className={inputCls} />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-black/60">Address</span>
                <input name="address" className={inputCls} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-black/60">Notes</span>
                <textarea name="notes" rows={2} className={inputCls} />
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded border border-black/20 px-4 py-1.5 text-sm">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {isPending ? "Saving..." : "Add vendor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

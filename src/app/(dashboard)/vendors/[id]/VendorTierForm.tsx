"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TIER_LABELS, TIER_RULES, VENDOR_TIERS, type VendorTier } from "@/lib/vendors";
import { setVendorTier } from "../vendor-actions";

// Shown only to team leaders and admins.
export default function VendorTierForm({ vendorId, currentTier }: { vendorId: string; currentTier: VendorTier }) {
  const router = useRouter();
  const [tier, setTier] = useState<VendorTier>(currentTier);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await setVendorTier(vendorId, tier, reason);
      if ("error" in result) return setError(result.error);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-black/10 p-4">
      <h2 className="text-sm font-semibold">Change tier</h2>
      <p className="text-xs text-black/50">
        Team leaders and admins only. Every change is recorded with your name and the reason.
      </p>
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-black/60">Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as VendorTier)}
            className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
          >
            {VENDOR_TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-black/60">Reason (required)</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Discussed pricing with the customer"
            className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || tier === currentTier}
          className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save tier"}
        </button>
      </div>
      {tier !== currentTier && <p className="text-xs text-black/60">{TIER_RULES[tier]}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

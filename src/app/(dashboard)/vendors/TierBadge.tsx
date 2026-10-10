import { TIER_LABELS, TIER_STYLES, type VendorTier } from "@/lib/vendors";

export function TierBadge({ tier }: { tier: VendorTier }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}>
      {TIER_LABELS[tier]}
      {tier === "dnc_tier_3" ? " — excluded" : tier === "dnc_tier_1" || tier === "dnc_tier_2" ? " — TL approval" : ""}
    </span>
  );
}

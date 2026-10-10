import type { VendorCandidate } from "./buildVendors";
import { formatPhone } from "./normalize";

export const TIER_LABEL: Record<string, string> = {
  preferred: "Preferred",
  non_preferred: "Non Preferred",
  dnc_tier_1: "DNC Tier 1 (TL approval)",
  dnc_tier_2: "DNC Tier 2 (TL approval)",
  dnc_tier_3: "DNC Tier 3 (excluded from dispatch)",
  unclassified: "Unclassified (held out of recommendations until a tier is set)",
};

export function vendorRow(v: VendorCandidate) {
  return {
    Name: v.name,
    "Name in map (original)": v.nameOriginal === v.name ? "" : v.nameOriginal,
    Tier: TIER_LABEL[v.tier],
    "Tier decided by": v.tierSource === "review" ? "Your review" : "Map",
    "Tier reason": v.tierReason,
    "Original Status": v.statusRaw,
    "Source layers": v.layers.join(" + "),
    Phone: formatPhone(v.phone),
    "Secondary phone": formatPhone(v.secondaryPhone),
    Email: v.email,
    Address: v.address,
    State: v.state ?? "",
    Location: v.locationQuality,
    Latitude: v.lat ?? "",
    Longitude: v.lng ?? "",
    "Service categories": v.serviceCategories.join(", "),
    "Services (original)": v.services.join("; "),
    Equipment: v.equipment.join("; "),
    "Heavy-duty capable": v.heavyDutyCapable ? "yes" : "",
    Notes: v.notes,
    "Pins merged": v.mergedFrom,
    Flags: v.flags.join(", "),
  };
}

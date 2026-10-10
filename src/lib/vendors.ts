import type { ServiceCategory } from "./vendorImport/normalize";

export const VENDOR_TIERS = [
  "preferred",
  "non_preferred",
  "dnc_tier_1",
  "dnc_tier_2",
  "dnc_tier_3",
  "unclassified",
] as const;
export type VendorTier = (typeof VENDOR_TIERS)[number];

export const TIER_LABELS: Record<VendorTier, string> = {
  preferred: "Preferred",
  non_preferred: "Non Preferred",
  dnc_tier_1: "DNC Tier 1",
  dnc_tier_2: "DNC Tier 2",
  dnc_tier_3: "DNC Tier 3",
  unclassified: "Unclassified",
};

// What each tier means for dispatch (per the team's DNC tier rules).
export const TIER_RULES: Record<VendorTier, string> = {
  preferred: "Prioritized when dispatching.",
  non_preferred: "Available for dispatch.",
  dnc_tier_1: "Team leader approval required before assigning any job. Less frequent or serious offenses.",
  dnc_tier_2: "Team leader approval required before assigning any job. More frequent offenses (late, not answering calls).",
  dnc_tier_3: "EXCLUDED FROM DISPATCH. No jobs may be assigned to this vendor.",
  unclassified: "Held out of recommendations until a tier is set.",
};

export const TIER_STYLES: Record<VendorTier, string> = {
  preferred: "bg-green-100 text-green-800",
  non_preferred: "bg-black/10 text-black/70",
  dnc_tier_1: "bg-amber-100 text-amber-800",
  dnc_tier_2: "bg-orange-100 text-orange-800",
  dnc_tier_3: "bg-red-100 text-red-800",
  unclassified: "bg-blue-100 text-blue-800",
};

export const SERVICE_LABELS: Record<ServiceCategory, string> = {
  light_duty_tow: "Light-duty towing",
  medium_duty_tow: "Medium-duty towing",
  heavy_duty_tow: "Heavy-duty towing",
  flatbed_tow: "Flatbed / rollback",
  towing_general: "Towing (general)",
  roadside_general: "Roadside assistance",
  tire_service: "Tire service",
  lockout: "Lockout",
  jump_start: "Jump start",
  battery_service: "Battery service",
  fuel_delivery: "Fuel delivery",
  winch_recovery: "Winch-out / recovery",
  auto_repair: "Auto repair",
  transport_hauling: "Transport / hauling",
  impound_storage: "Impound / storage",
  junk_removal: "Junk car removal",
};

export interface Vendor {
  id: string;
  name: string;
  name_original: string | null;
  tier: VendorTier;
  tier_source: "map" | "review" | "hub";
  tier_reason: string | null;
  tier_changed_at: string | null;
  contact_name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  secondary_email: string | null;
  address: string | null;
  state: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  location_quality: "point" | "latlong_in_address" | "street_address" | "city_only" | "none";
  needs_geocode: boolean;
  service_categories: string[];
  services_original: string | null;
  equipment: string | null;
  heavy_duty_capable: boolean;
  heavy_duty_only: boolean;
  source_layers: string[];
  notes: string | null;
  import_flags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function formatPhoneDisplay(digits: string | null): string {
  if (!digits) return "";
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

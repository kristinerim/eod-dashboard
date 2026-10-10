// Pure rules behind the nearby-vendor panel: which vendors can do the job
// being asked for, how they are grouped, and how far away they are.

import type { ServiceCategory } from "./vendorImport/normalize";
import type { VendorTier } from "./vendors";

export type ServiceNeed = {
  label: string;
  groups: ServiceCategory[];
  heavy: boolean;
};

const TOW_GROUPS: ServiceCategory[] = ["light_duty_tow", "medium_duty_tow", "flatbed_tow", "towing_general"];

// What the requested Job Type needs from a vendor. Returns null when the type
// doesn't point at one kind of work (e.g. "Special Request"), in which case
// no service filtering is done.
export function serviceNeedForJobType(jobType: string): ServiceNeed | null {
  const jt = jobType.toLowerCase();
  if (!jt.trim()) return null;
  if (/special request/.test(jt)) return null;

  if (/heavy/.test(jt)) {
    return { label: "Heavy-duty", groups: ["heavy_duty_tow", "winch_recovery"], heavy: true };
  }
  if (/\btow|decking|recovery|storage|two-way/.test(jt)) {
    return { label: "Towing", groups: TOW_GROUPS, heavy: false };
  }
  if (/winch/.test(jt)) {
    return { label: "Winch-out / recovery", groups: ["winch_recovery", ...TOW_GROUPS], heavy: false };
  }
  if (/lockout|locksmith/.test(jt)) {
    return { label: "Lockout", groups: ["lockout", "roadside_general"], heavy: false };
  }
  if (/jump/.test(jt)) {
    return { label: "Jump start", groups: ["jump_start", "battery_service", "roadside_general"], heavy: false };
  }
  if (/battery/.test(jt)) {
    return { label: "Battery", groups: ["battery_service", "roadside_general"], heavy: false };
  }
  if (/tire/.test(jt)) {
    return { label: "Tire service", groups: ["tire_service", "roadside_general"], heavy: false };
  }
  if (/fuel/.test(jt)) {
    return { label: "Fuel delivery", groups: ["fuel_delivery", "roadside_general"], heavy: false };
  }
  return null;
}

export type ServiceMatch = "match" | "unlisted" | "no";

export function matchService(
  need: ServiceNeed | null,
  vendor: { service_categories: string[]; heavy_duty_capable: boolean; heavy_duty_only: boolean }
): ServiceMatch {
  if (!need) return "match";
  // Heavy-duty-only shops don't take a car.
  if (vendor.heavy_duty_only && !need.heavy) return "no";
  if (vendor.service_categories.length === 0) return "unlisted";
  if (need.groups.some((g) => vendor.service_categories.includes(g))) return "match";
  if (need.heavy && vendor.heavy_duty_capable) return "match";
  return "no";
}

// Tier 3 is never dispatched, and unclassified vendors are held out until a
// team leader sets a tier. Tier 1 and 2 are shown, but need approval.
export const SEARCHABLE_TIERS: VendorTier[] = ["preferred", "non_preferred", "dnc_tier_1", "dnc_tier_2"];

export function needsTeamLeaderApproval(tier: string | null | undefined): boolean {
  return tier === "dnc_tier_1" || tier === "dnc_tier_2";
}

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Latitude/longitude window around a point, used to let the database narrow
// the vendors before the exact distance is worked out here.
export function boundingBox(lat: number, lng: number, miles: number) {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Rough drive time when Google's exact figure isn't available: roads wind,
// so scale the straight line, then assume an average speed.
export function estimateDrive(straightMiles: number): { miles: number; minutes: number } {
  const miles = straightMiles * 1.25;
  return { miles, minutes: Math.max(1, Math.round((miles / 45) * 60)) };
}

export function formatDriveTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

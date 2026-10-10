"use server";

import { createClient } from "@/lib/supabase/server";
import { getApproverNameOptions } from "@/lib/profile";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { ServiceCategory } from "@/lib/vendorImport/normalize";
import type { VendorTier } from "@/lib/vendors";
import {
  SEARCHABLE_TIERS,
  boundingBox,
  estimateDrive,
  haversineMiles,
  matchService,
  serviceNeedForJobType,
} from "@/lib/vendorSearch";

// A recommended vendor. Distances here are straight-line from the vendors'
// stored coordinates (no Google call); exact drive times are fetched
// separately, only for the vendors actually on screen.
export type RecommendedVendor = {
  id: string;
  name: string;
  phone: string | null;
  contactName: string | null;
  tier: VendorTier;
  address: string | null;
  state: string | null;
  straightMiles: number;
  estimatedMinutes: number;
  services: ServiceCategory[];
  servicesListed: boolean;
  heavyDutyOnly: boolean;
  approximateLocation: boolean;
};

export type RecommendationResult =
  | {
      ok: true;
      radiusMiles: number;
      serviceLabel: string | null;
      // Preferred first, then Non Preferred, each nearest-first.
      recommended: RecommendedVendor[];
      // DNC Tier 1 / 2: never part of the normal list; a team leader must approve.
      needsApproval: RecommendedVendor[];
    }
  | { error: string };

type VendorRow = {
  id: string;
  name: string;
  phone: string | null;
  contact_name: string | null;
  tier: VendorTier;
  address: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  location_quality: string;
  service_categories: ServiceCategory[];
  heavy_duty_capable: boolean;
  heavy_duty_only: boolean;
};

type Candidate = VendorRow & { straightMiles: number; unlisted: boolean };

const RADII = [50, 100, 200, 400];
const WANT_PREFERRED = 5;
const MAX_LISTED = 12;
const MAX_APPROVAL = 3;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function candidatesWithin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lat: number,
  lng: number,
  radius: number,
  jobType: string
): Promise<Candidate[]> {
  const box = boundingBox(lat, lng, radius);
  const need = serviceNeedForJobType(jobType);
  const rows = await fetchAllRows<VendorRow>(() =>
    supabase
      .from("vendors")
      .select(
        "id,name,phone,contact_name,tier,address,state,latitude,longitude,location_quality,service_categories,heavy_duty_capable,heavy_duty_only"
      )
      .eq("is_active", true)
      .in("tier", SEARCHABLE_TIERS)
      .gte("latitude", box.minLat)
      .lte("latitude", box.maxLat)
      .gte("longitude", box.minLng)
      .lte("longitude", box.maxLng)
      .order("id")
  );

  const out: Candidate[] = [];
  for (const v of rows) {
    const straightMiles = haversineMiles(lat, lng, Number(v.latitude), Number(v.longitude));
    if (straightMiles > radius) continue;
    const match = matchService(need, v);
    if (match === "no") continue;
    out.push({ ...v, straightMiles, unlisted: match === "unlisted" });
  }
  return out.sort((a, b) => a.straightMiles - b.straightMiles);
}

function shape(c: Candidate): RecommendedVendor {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    contactName: c.contact_name,
    tier: c.tier,
    address: c.address,
    state: c.state,
    straightMiles: c.straightMiles,
    estimatedMinutes: estimateDrive(c.straightMiles).minutes,
    services: c.service_categories,
    servicesListed: !c.unlisted,
    heavyDutyOnly: c.heavy_duty_only,
    approximateLocation: c.location_quality === "city_only",
  };
}

// Recommended vendors for a pinned location and job type. Uses only the
// database: no Google request is made here.
export async function findRecommendedVendors(input: {
  latitude: number;
  longitude: number;
  jobType: string;
}): Promise<RecommendationResult> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Not signed in." };

  const { latitude: lat, longitude: lng } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: "The service location isn't pinned yet." };
  }
  const jobType = String(input.jobType ?? "").slice(0, 200);

  let candidates: Candidate[] = [];
  let radius = RADII[0];
  try {
    for (const r of RADII) {
      radius = r;
      candidates = await candidatesWithin(supabase, lat, lng, r, jobType);
      const preferred = candidates.filter((c) => c.tier === "preferred").length;
      const eligible = candidates.filter((c) => c.tier === "preferred" || c.tier === "non_preferred").length;
      // Reach out until there are three Preferred vendors; keep going past 200
      // miles only if there still aren't three vendors of any kind.
      if (preferred >= WANT_PREFERRED) break;
      if (r >= 200 && eligible >= WANT_PREFERRED) break;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't search vendors." };
  }

  const tierOrder = (t: VendorTier) => (t === "preferred" ? 0 : 1);
  const recommended = candidates
    .filter((c) => c.tier === "preferred" || c.tier === "non_preferred")
    .sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier) || a.straightMiles - b.straightMiles)
    .slice(0, MAX_LISTED)
    .map(shape);
  const needsApproval = candidates
    .filter((c) => c.tier === "dnc_tier_1" || c.tier === "dnc_tier_2")
    .slice(0, MAX_APPROVAL)
    .map(shape);

  return {
    ok: true,
    radiusMiles: radius,
    serviceLabel: serviceNeedForJobType(jobType)?.label ?? null,
    recommended,
    needsApproval,
  };
}

// Drive times already worked out, shared by everyone using this server, so a
// location that comes up again (a repeat customer, two agents on the same
// call) doesn't cost another Google request. Rounded to ~100 m; kept a day.
const DRIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DRIVE_CACHE_MAX = 5000;
const driveCache = new Map<string, { at: number; miles: number; minutes: number }>();

function driveKey(lat: number, lng: number, vendorId: string) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}|${vendorId}`;
}

// Exact drive time and distance from Google, for just the vendors on screen.
// Coordinates come from the database, never from the browser.
export async function getDriveTimes(input: {
  latitude: number;
  longitude: number;
  vendorIds: string[];
}): Promise<Record<string, { miles: number; minutes: number }>> {
  const { supabase, user } = await requireUser();
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  const { latitude: lat, longitude: lng } = input;
  const ids = Array.from(new Set(input.vendorIds ?? []))
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 12);
  if (!user || !key || ids.length === 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) return {};

  const out: Record<string, { miles: number; minutes: number }> = {};
  const now = Date.now();
  const uncached: string[] = [];
  for (const id of ids) {
    const hit = driveCache.get(driveKey(lat, lng, id));
    if (hit && now - hit.at < DRIVE_CACHE_TTL_MS) out[id] = { miles: hit.miles, minutes: hit.minutes };
    else uncached.push(id);
  }
  if (uncached.length === 0) return out;

  const { data } = await supabase.from("vendors").select("id,latitude,longitude").in("id", uncached);
  const vendors = (data ?? []).filter((v) => v.latitude !== null && v.longitude !== null);
  if (vendors.length === 0) return out;

  try {
    const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify({
        origins: [{ waypoint: { location: { latLng: { latitude: lat, longitude: lng } } } }],
        destinations: vendors.map((v) => ({
          waypoint: { location: { latLng: { latitude: Number(v.latitude), longitude: Number(v.longitude) } } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
      cache: "no-store",
    });
    if (!res.ok) return out;
    const body = (await res.json()) as {
      destinationIndex?: number;
      duration?: string;
      distanceMeters?: number;
      condition?: string;
    }[];
    for (const el of body) {
      if (el.destinationIndex === undefined || el.condition !== "ROUTE_EXISTS" || !el.duration) continue;
      const seconds = Number.parseInt(el.duration, 10);
      if (!Number.isFinite(seconds)) continue;
      const result = {
        miles: (el.distanceMeters ?? 0) / 1609.344,
        minutes: Math.max(1, Math.round(seconds / 60)),
      };
      out[vendors[el.destinationIndex].id] = result;
      if (driveCache.size >= DRIVE_CACHE_MAX) driveCache.delete(driveCache.keys().next().value as string);
      driveCache.set(driveKey(lat, lng, vendors[el.destinationIndex].id), { at: now, ...result });
    }
  } catch {
    // the page keeps showing estimates
  }
  return out;
}

// Pins a typed-in service location (when the agent didn't use address search).
export async function geocodeServiceAddress(
  address: string
): Promise<{ latitude: number; longitude: number } | { error: string }> {
  const { user } = await requireUser();
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!user) return { error: "Not signed in." };
  if (!key) return { error: "Address lookup isn't connected." };
  const text = String(address ?? "").trim().slice(0, 300);
  if (text.length < 5) return { error: "Address is too short." };

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", text);
  url.searchParams.set("components", "country:US|country:CA");
  url.searchParams.set("key", key);
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json()) as {
      status: string;
      results: { geometry: { location: { lat: number; lng: number } } }[];
    };
    if (body.status !== "OK" || !body.results[0]) return { error: "Couldn't find that address." };
    const loc = body.results[0].geometry.location;
    return { latitude: loc.lat, longitude: loc.lng };
  } catch {
    return { error: "Address lookup failed." };
  }
}

// Team leaders and admins who can approve using a DNC Tier 1 / 2 vendor.
export async function listApproverNames(): Promise<string[]> {
  return getApproverNameOptions();
}

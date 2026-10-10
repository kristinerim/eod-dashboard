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

export type NearbyVendor = {
  id: string;
  name: string;
  phone: string | null;
  contactName: string | null;
  tier: VendorTier;
  address: string | null;
  state: string | null;
  straightMiles: number;
  driveMiles: number;
  driveMinutes: number;
  exactDriveTime: boolean;
  services: ServiceCategory[];
  servicesListed: boolean;
  heavyDutyOnly: boolean;
  approximateLocation: boolean;
};

export type NearbyResult =
  | {
      ok: true;
      radiusMiles: number;
      serviceLabel: string | null;
      preferred: NearbyVendor[];
      nonPreferred: NearbyVendor[];
      needsApproval: NearbyVendor[];
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

const RADII = [50, 100, 200, 400];
const SHOW = { preferred: 6, nonPreferred: 4, needsApproval: 3 };

type Candidate = VendorRow & { straightMiles: number; unlisted: boolean };

async function findCandidates(
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

// Exact drive time and distance from Google for the vendors being shown. One
// request covers them all. On any failure the caller falls back to estimates.
async function driveTimes(
  lat: number,
  lng: number,
  vendors: Candidate[]
): Promise<Map<string, { miles: number; minutes: number }>> {
  const times = new Map<string, { miles: number; minutes: number }>();
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key || vendors.length === 0) return times;
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
    if (!res.ok) return times;
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
      times.set(vendors[el.destinationIndex].id, {
        miles: (el.distanceMeters ?? 0) / 1609.344,
        minutes: Math.max(1, Math.round(seconds / 60)),
      });
    }
  } catch {
    // estimates are used instead
  }
  return times;
}

export async function findNearbyVendors(input: {
  latitude: number;
  longitude: number;
  jobType: string;
}): Promise<NearbyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { latitude: lat, longitude: lng } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: "Pin the service location first (search the address, or enter latitude and longitude)." };
  }

  const jobType = String(input.jobType ?? "").slice(0, 200);
  let candidates: Candidate[] = [];
  let radius = RADII[0];
  try {
    for (const r of RADII) {
      radius = r;
      candidates = await findCandidates(supabase, lat, lng, r, jobType);
      if (candidates.filter((c) => c.tier === "preferred").length >= SHOW.preferred) break;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't search vendors." };
  }

  const byTier = (tiers: VendorTier[], n: number) => candidates.filter((c) => tiers.includes(c.tier)).slice(0, n);
  const picked = {
    preferred: byTier(["preferred"], SHOW.preferred),
    nonPreferred: byTier(["non_preferred"], SHOW.nonPreferred),
    needsApproval: byTier(["dnc_tier_1", "dnc_tier_2"], SHOW.needsApproval),
  };

  const all = [...picked.preferred, ...picked.nonPreferred, ...picked.needsApproval];
  const exact = await driveTimes(lat, lng, all);

  const shape = (c: Candidate): NearbyVendor => {
    const real = exact.get(c.id);
    const est = estimateDrive(c.straightMiles);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      contactName: c.contact_name,
      tier: c.tier,
      address: c.address,
      state: c.state,
      straightMiles: c.straightMiles,
      driveMiles: real?.miles ?? est.miles,
      driveMinutes: real?.minutes ?? est.minutes,
      exactDriveTime: Boolean(real),
      services: c.service_categories,
      servicesListed: !c.unlisted,
      heavyDutyOnly: c.heavy_duty_only,
      approximateLocation: c.location_quality === "city_only",
    };
  };

  return {
    ok: true,
    radiusMiles: radius,
    serviceLabel: serviceNeedForJobType(jobType)?.label ?? null,
    preferred: picked.preferred.map(shape),
    nonPreferred: picked.nonPreferred.map(shape),
    needsApproval: picked.needsApproval.map(shape),
  };
}

// Team leaders and admins who can approve using a DNC Tier 1 / 2 vendor.
export async function listApproverNames(): Promise<string[]> {
  return getApproverNameOptions();
}

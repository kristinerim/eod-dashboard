"use server";

import { createClient } from "@/lib/supabase/server";

// The driving distance from the customer's pickup to the drop-off. This is
// the trip itself — separate from how far a vendor is from the pickup.
//
// Results are shared by everyone on this server and kept for a week, so the
// same trip being entered again (or the form being reopened) costs nothing.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;
const cache = new Map<string, { at: number; miles: number }>();

type Place = { latitude: number; longitude: number } | { address: string };

function placeKey(p: Place): string {
  return "address" in p
    ? `a:${p.address.trim().toLowerCase().replace(/\s+/g, " ")}`
    : `c:${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
}

function waypoint(p: Place) {
  return "address" in p
    ? { address: p.address.trim().slice(0, 300) }
    : { location: { latLng: { latitude: p.latitude, longitude: p.longitude } } };
}

function valid(p: Place): boolean {
  if ("address" in p) return typeof p.address === "string" && p.address.trim().length >= 5;
  return (
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}

export async function calculateTripDistance(input: {
  pickup: Place;
  dropoff: Place;
}): Promise<{ miles: number; cached: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { error: "Distance lookup isn't connected." };
  if (!valid(input.pickup) || !valid(input.dropoff)) return { error: "Both addresses are needed." };

  const cacheKey = `${placeKey(input.pickup)}>${placeKey(input.dropoff)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return { miles: hit.miles, cached: true };

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: waypoint(input.pickup),
        destination: waypoint(input.dropoff),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
      cache: "no-store",
    });
    if (!res.ok) return { error: "Couldn't calculate the distance." };
    const body = (await res.json()) as { routes?: { distanceMeters?: number }[] };
    const meters = body.routes?.[0]?.distanceMeters;
    if (typeof meters !== "number") return { error: "No driving route found between those addresses." };

    const miles = Math.round((meters / 1609.344) * 10) / 10;
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, { at: Date.now(), miles });
    return { miles, cached: false };
  } catch {
    return { error: "Couldn't calculate the distance." };
  }
}

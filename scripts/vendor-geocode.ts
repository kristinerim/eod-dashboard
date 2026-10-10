// One-time geocoding of vendors that have an address but no map coordinates.
//
// Safety rules:
//   - It only ever writes latitude, longitude, location_quality, needs_geocode and
//     (on failure) an import flag. Tiers, names, phones and every other field are
//     never touched.
//   - Vendors that already have coordinates are never re-geocoded.
//   - A vendor that fails keeps needs_geocode = true and gets a "geocode_failed"
//     flag, and is skipped on the next run unless --retry is passed.
//
// Usage:
//   set -a && source .env.local && set +a
//   npx tsx scripts/vendor-geocode.ts --limit 20     # small test
//   npx tsx scripts/vendor-geocode.ts                # everything that needs it

import { createClient } from "@supabase/supabase-js";

const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;
const RETRY = process.argv.includes("--retry");
const CONCURRENCY = 5;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const KEY = process.env.GOOGLE_MAPS_SERVER_KEY!;
if (!KEY) throw new Error("GOOGLE_MAPS_SERVER_KEY is not set");

type Row = { id: string; address: string | null; country: string; import_flags: string[] };

async function loadTodo(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("vendors")
      .select("id,address,country,import_flags")
      .eq("needs_geocode", true)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows.filter((r) => r.address && (RETRY || !r.import_flags.includes("geocode_failed")));
}

type Geo = { lat: number; lng: number; quality: "street_address" | "city_only" } | { error: string };

async function geocode(address: string, country: string): Promise<Geo> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("region", country === "CA" ? "ca" : "us");
  url.searchParams.set("key", KEY);
  const res = await fetch(url);
  const body = (await res.json()) as {
    status: string;
    error_message?: string;
    results: { geometry: { location: { lat: number; lng: number }; location_type: string }; types: string[] }[];
  };
  if (body.status === "OVER_QUERY_LIMIT") return { error: "OVER_QUERY_LIMIT" };
  if (body.status !== "OK" || !body.results[0]) return { error: body.status };
  const r = body.results[0];
  const precise = r.types.some((t) =>
    ["street_address", "premise", "subpremise", "route", "intersection", "establishment", "point_of_interest"].includes(t)
  );
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, quality: precise ? "street_address" : "city_only" };
}

async function main() {
  const todo = (await loadTodo()).slice(0, LIMIT);
  console.log(`${todo.length} vendors to geocode`);
  let ok = 0;
  let failed = 0;
  let cityOnly = 0;
  let stop = false;
  let next = 0;

  async function worker() {
    while (!stop) {
      const i = next++;
      if (i >= todo.length) return;
      const row = todo[i];
      let geo: Geo;
      try {
        geo = await geocode(row.address!, row.country);
      } catch (e) {
        geo = { error: String(e) };
      }
      if ("error" in geo) {
        if (geo.error === "OVER_QUERY_LIMIT") {
          console.error("Google says the quota is used up. Stopping.");
          stop = true;
          return;
        }
        failed++;
        await supabase
          .from("vendors")
          .update({ import_flags: [...row.import_flags, "geocode_failed"] })
          .eq("id", row.id);
      } else {
        ok++;
        if (geo.quality === "city_only") cityOnly++;
        const { error } = await supabase
          .from("vendors")
          .update({ latitude: geo.lat, longitude: geo.lng, location_quality: geo.quality, needs_geocode: false })
          .eq("id", row.id);
        if (error) throw error;
      }
      if ((ok + failed) % 100 === 0) console.log(`  ${ok + failed}/${todo.length}  (ok ${ok}, failed ${failed})`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Done. Located ${ok} (${cityOnly} only to city level), failed ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Fixes vendors whose "address" holds a services list (a spreadsheet mix-up)
// or that have no address at all:
//   1. Looks the business up on Google by name + phone and accepts a result only
//      when its phone number matches the vendor's exactly.
//   2. Moves the misplaced services text into the services fields (without
//      losing anything already there).
//
// Usage:
//   set -a && source .env.local && set +a
//   npx tsx scripts/vendor-fix-addresses.ts --dry-run
//   npx tsx scripts/vendor-fix-addresses.ts

import { createClient } from "@supabase/supabase-js";
import { categorizeService, splitList, type ServiceCategory } from "../src/lib/vendorImport/normalize";
import { parsePlaceAddress, type PlaceComponent } from "../src/lib/places";

const DRY_RUN = process.argv.includes("--dry-run");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
// The browser key is the one allowed to use Places; it only accepts requests
// that come from the site, so say so.
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY!;

type Row = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  services_original: string | null;
  service_categories: ServiceCategory[];
  import_flags: string[];
};

type Place = {
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: PlaceComponent[];
};

async function searchByNameAndPhone(name: string, phone: string): Promise<Place | null> {
  const area = `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  for (const q of [`${name} ${area}`, `${name} tow ${area}`, area]) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        Referer: "https://www.quicktowinghub.com/",
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.location,places.addressComponents",
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: 5 }),
    });
    if (!res.ok) throw new Error(`Places search failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { places?: Place[] };
    const hit = (body.places ?? []).find((p) => (p.nationalPhoneNumber ?? "").replace(/\D/g, "") === phone);
    if (hit) return hit;
  }
  return null;
}

const looksLikeServices = (text: string) =>
  /(tow|recovery|roadside|assist|tire|lockout|jump|fuel|winch|flatbed|repair|haul)/i.test(text) && !/\d{3,}/.test(text);

async function main() {
  const { data, error } = await supabase
    .from("vendors")
    .select("id,name,phone,address,services_original,service_categories,import_flags")
    .or("import_flags.cs.{geocode_failed},import_flags.cs.{no_location}");
  if (error) throw error;

  for (const v of data as Row[]) {
    const update: Record<string, unknown> = {};
    const notes: string[] = [];

    // Services text sitting in the address field.
    if (v.address && looksLikeServices(v.address)) {
      const tokens = splitList(v.address);
      const cats = new Set<ServiceCategory>(v.service_categories);
      for (const t of tokens) for (const c of categorizeService(t)) cats.add(c);
      update.service_categories = Array.from(cats);
      update.services_original = [v.services_original, v.address].filter(Boolean).join("; ");
      update.address = null;
      notes.push(`moved services text out of address (${tokens.length} items)`);
    }

    // Find the real address.
    if (v.phone) {
      const place = await searchByNameAndPhone(v.name, v.phone);
      if (place?.location && place.formattedAddress) {
        const a = parsePlaceAddress(place.addressComponents);
        update.address = place.formattedAddress;
        if (a.state) update.state = a.state;
        update.latitude = place.location.latitude;
        update.longitude = place.location.longitude;
        update.location_quality = "street_address";
        update.needs_geocode = false;
        update.import_flags = v.import_flags.filter((f) => !["geocode_failed", "no_location", "city_level_location_only"].includes(f));
        notes.push(`address found by phone match: ${place.formattedAddress}`);
      } else {
        notes.push("no Google listing with this exact phone number");
      }
    }

    console.log(`${v.name}: ${notes.join(" | ")}`);
    if (!DRY_RUN && Object.keys(update).length > 0) {
      const { error: e } = await supabase.from("vendors").update(update).eq("id", v.id);
      if (e) throw e;
    }
  }
  console.log(DRY_RUN ? "(dry run — nothing written)" : "Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

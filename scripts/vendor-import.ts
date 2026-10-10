// REAL IMPORT of the reviewed vendor list into the Hub's `vendors` table.
//
// Safety rules (this script cannot break them):
//   - It only ever INSERTS. It never updates or deletes an existing vendor, so
//     re-running it can never overwrite a tier, a restriction, or an edit.
//   - Each vendor has a stable import_key; one that already exists is skipped.
//   - --dry-run connects to nothing and only reports what would happen.
//
// Usage:
//   set -a && source .env.local && set +a
//   npx tsx scripts/vendor-import.ts "<map.kmz>" "<revised.xlsx>" --dry-run
//   npx tsx scripts/vendor-import.ts "<map.kmz>" "<revised.xlsx>"

import { createClient } from "@supabase/supabase-js";
import { buildFinalPlan } from "./finalPlan";
import type { VendorCandidate } from "../src/lib/vendorImport/buildVendors";
import { addressKey, nameKey } from "../src/lib/vendorImport/normalize";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY_RUN = process.argv.includes("--dry-run");
const [kmzPath, revisedPath] = args;
if (!kmzPath || !revisedPath) {
  console.error('Usage: npx tsx scripts/vendor-import.ts "<map.kmz>" "<revised.xlsx>" [--dry-run]');
  process.exit(1);
}

const { result } = buildFinalPlan(kmzPath, revisedPath);
const vendors = result.plan.vendors;

// A stable identity that doesn't depend on row order or the order of layers.
function importKeyFor(v: VendorCandidate, used: Set<string>): string {
  const base = v.phone ? `${v.phone}|${nameKey(v.name)}` : `nophone|${nameKey(v.name)}|${addressKey(v.address)}`;
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}|${n}`;
  used.add(key);
  return key;
}

const usedKeys = new Set<string>();
const rows = vendors.map((v) => ({
  name: v.name,
  name_original: v.nameOriginal,
  tier: v.tier,
  tier_source: v.tierSource,
  tier_reason: v.tierReason || null,
  contact_name: v.contactName || null,
  phone: v.phone,
  secondary_phone: v.secondaryPhone,
  email: v.email || null,
  secondary_email: v.secondaryEmail || null,
  address: v.address || null,
  state: v.state,
  country: "US",
  latitude: v.lat,
  longitude: v.lng,
  location_quality: v.locationQuality,
  needs_geocode: v.locationQuality === "street_address" || v.locationQuality === "city_only",
  service_categories: v.serviceCategories,
  services_original: v.services.join("; ") || null,
  equipment: v.equipment.join("; ") || null,
  heavy_duty_capable: v.heavyDutyCapable,
  source_layers: v.layers,
  notes: v.notes || null,
  import_flags: v.flags,
  import_key: importKeyFor(v, usedKeys),
}));

const byTier = new Map<string, number>();
for (const r of rows) byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1);
const collisions = rows.filter((r) => /\|\d+$/.test(r.import_key)).length;

console.log(`vendors to import: ${rows.length}`);
console.log("by tier:", Object.fromEntries(byTier));
console.log(`import keys that needed a suffix to stay unique: ${collisions}`);
console.log(`vendors needing a one-time address lookup: ${rows.filter((r) => r.needs_geocode).length}`);

async function main() {
  if (DRY_RUN) {
    console.log("\nDRY RUN — nothing was written.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { count: existing, error: countError } = await supabase.from("vendors").select("id", { count: "exact", head: true });
  if (countError) throw new Error(`Cannot read the vendors table (was the SQL run?): ${countError.message}`);
  console.log(`vendors already in the Hub: ${existing ?? 0}`);

  const { data: run, error: runError } = await supabase
    .from("vendor_import_runs")
    .insert({ source_file: kmzPath.split("/").pop(), notes: "Initial import from Google My Maps with reviewed decisions applied" })
    .select("id")
    .single();
  if (runError || !run) throw new Error(`Could not create the import log entry: ${runError?.message}`);

  let created = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((r) => ({ ...r, import_run_id: run.id }));
    const { data, error } = await supabase
      .from("vendors")
      .upsert(batch, { onConflict: "import_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Batch starting at ${i} failed: ${error.message}`);
    created += data?.length ?? 0;
    process.stdout.write(`\rimported ${created} / ${rows.length}`);
  }
  const skipped = rows.length - created;
  await supabase.from("vendor_import_runs").update({ vendors_created: created, vendors_skipped: skipped }).eq("id", run.id);
  console.log(`\ncreated: ${created}, skipped (already existed): ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

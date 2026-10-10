// DRY RUN — reads a Google My Maps export (.kmz/.kml) and writes an Excel
// review workbook describing exactly what a real import would do. It does not
// connect to the database and writes nothing but the workbook.
//
// Usage:
//   npx tsx scripts/vendor-dry-run.ts "<export.kmz>" "<output.xlsx>"

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { kmlTextFromBytes, parseMyMapsKml } from "../src/lib/vendorImport/parseMyMaps";
import { buildImportPlan, type VendorCandidate } from "../src/lib/vendorImport/buildVendors";
import { categorizeService, formatPhone } from "../src/lib/vendorImport/normalize";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: npx tsx scripts/vendor-dry-run.ts "<export.kmz>" "<output.xlsx>"');
  process.exit(1);
}

const pins = parseMyMapsKml(kmlTextFromBytes(new Uint8Array(readFileSync(inputPath))));
const plan = buildImportPlan(pins);

const TIER_LABEL: Record<string, string> = {
  preferred: "Preferred",
  non_preferred: "Non Preferred",
  dnc_tier_1: "DNC Tier 1 (TL approval)",
  dnc_tier_2: "DNC Tier 2 (TL approval)",
  dnc_tier_3: "DNC Tier 3 (excluded from dispatch)",
  unclassified: "Unclassified (held out of recommendations until a tier is set)",
};

const REVIEW_REASON: Record<string, string> = {
  name_says_dnc_status_disagrees:
    "SAFETY: the name/notes say DNC but the Status says otherwise — held out of recommendations until a tier is set",
  name_says_stricter_tier_than_status: "The tier written in the name is stricter than the Status — the stricter one was used",
  status_layer_conflict: "Status and layer disagree — the stricter one was used",
  status_blank: "Status is blank and nothing else classifies this vendor",
  status_unrecognized: "Status isn't a recognized value and nothing else classifies this vendor",
  status_blank_used_layer: "Status is blank — tier taken from the layer",
  status_unrecognized_used_layer: "Status isn't a recognized value — tier taken from the layer",
  no_phone: "No usable phone number",
  no_location: "No usable address or coordinates",
  coordinates_out_of_range: "Coordinates look wrong (outside North America)",
  possible_duplicate: "Another pin has the same phone number but a different name/address",
  address_is_us_but_notes_or_address_mention_canada: "US address, but the notes/address also mention Canada — kept as US, please confirm",
};
const REVIEW_FLAGS = Object.keys(REVIEW_REASON);

function vendorRow(v: VendorCandidate) {
  return {
    Name: v.name,
    "Name in map (original)": v.nameOriginal === v.name ? "" : v.nameOriginal,
    Tier: TIER_LABEL[v.tier],
    "Original Status": v.statusRaw,
    "Source layers": v.layers.join(" + "),
    Phone: formatPhone(v.phone),
    "Secondary phone": formatPhone(v.secondaryPhone),
    Email: v.email,
    Address: v.address,
    State: v.state ?? "",
    "Location": v.locationQuality,
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

const count = <T,>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
};

const { vendors, excludedCanadian, duplicateGroups } = plan;
const needsReview = vendors
  .filter((v) => v.tier === "unclassified" || v.flags.some((f) => REVIEW_FLAGS.includes(f)))
  .sort((a, b) => Number(b.flags.includes("name_says_dnc_status_disagrees")) - Number(a.flags.includes("name_says_dnc_status_disagrees")));
const dncNameConflicts = vendors.filter(
  (v) => v.flags.includes("name_says_dnc_status_disagrees") || v.flags.includes("name_says_stricter_tier_than_status")
);

const byTier = count(vendors, (v) => TIER_LABEL[v.tier]);
const byLocation = count(vendors, (v) => v.locationQuality);
const blankServices = vendors.filter((v) => v.flags.includes("services_blank")).length;

const summary: (string | number)[][] = [
  ["VENDOR IMPORT — DRY RUN (nothing has been saved anywhere)", ""],
  ["", ""],
  ["Pins read from the map", plan.totalPins],
  ["Canadian vendors skipped (per your instruction)", excludedCanadian.length],
  ["Duplicate pins merged into one vendor", plan.totalPins - excludedCanadian.length - vendors.length],
  ["Vendors that would be created", vendors.length],
  ["  ...of which need a human look (see 'Needs review')", needsReview.length],
  ["  SAFETY: vendors whose NAME says DNC but whose Status disagrees (see 'DNC name conflicts')", dncNameConflicts.length],
  ["", ""],
  ["BY TIER", ""],
  ...[...byTier.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [`  ${k}`, n]),
  ["", ""],
  ["LOCATIONS", ""],
  ["  Exact coordinates already in the map", byLocation.get("point") ?? 0],
  ["  Coordinates written in the address field (readable as-is)", byLocation.get("latlong_in_address") ?? 0],
  ["  Street address (will be looked up once, within Google's free allowance)", byLocation.get("street_address") ?? 0],
  ["  City/state only (approximate location)", byLocation.get("city_only") ?? 0],
  ["  No usable location (can't appear on the map until fixed)", byLocation.get("none") ?? 0],
  ["", ""],
  ["SERVICES", ""],
  ["  Vendors with Services blank (kept, shown as 'services not listed')", blankServices],
  ["  Heavy-duty capable (HD layer or lists heavy duty)", vendors.filter((v) => v.heavyDutyCapable).length],
  ["", ""],
  ["DUPLICATES BY PHONE NUMBER", ""],
  ["  Merged automatically (same phone + name + address)", duplicateGroups.filter((g) => g.decision === "merged").length],
  ["  Left separate for review (same phone, different name/address)", duplicateGroups.filter((g) => g.decision === "needs_review").length],
];

const wb = XLSX.utils.book_new();
const addSheet = (name: string, rows: Record<string, unknown>[]) => {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "(none)": "" }]);
  const cols = Object.keys(rows[0] ?? { "(none)": "" });
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(48, Math.max(12, c.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
};

const summaryWs = XLSX.utils.aoa_to_sheet(summary);
summaryWs["!cols"] = [{ wch: 78 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

addSheet(
  "Needs review",
  needsReview.map((v) => ({
    Why: v.flags
      .filter((f) => REVIEW_FLAGS.includes(f))
      .map((f) => REVIEW_REASON[f])
      .join("; ") || (v.tier === "unclassified" ? "No tier could be determined" : ""),
    ...vendorRow(v),
  }))
);

addSheet(
  "DNC name conflicts",
  dncNameConflicts.map((v) => ({
    "What happened": v.flags.includes("name_says_dnc_status_disagrees")
      ? "Held out of recommendations (name says DNC, no tier given)"
      : "Name has a stricter tier than the Status — stricter tier used",
    ...vendorRow(v),
  }))
);

addSheet(
  "DNC vendors",
  vendors
    .filter((v) => v.tier.startsWith("dnc_"))
    .sort((a, b) => b.tier.localeCompare(a.tier) || a.name.localeCompare(b.name))
    .map(vendorRow)
);

addSheet("Canadian (skipped)", excludedCanadian.map(vendorRow));

addSheet(
  "Duplicate phones",
  duplicateGroups.flatMap((g) =>
    g.members.map((m, i) => ({
      Phone: formatPhone(g.phone),
      Decision: i === 0 ? (g.decision === "merged" ? "Merged into one vendor" : "Needs review") : "",
      Reason: i === 0 ? g.reason : "",
      Name: m.name,
      Layer: m.layer,
      Status: m.statusRaw,
      Address: m.address,
    }))
  )
);

const serviceCounts = count(
  vendors.flatMap((v) => v.services),
  (s) => s.trim()
);
addSheet(
  "Service wording",
  [...serviceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([token, n]) => ({
      "Wording in map": token,
      Pins: n,
      "Becomes category": categorizeService(token).join(", ") || "NOT RECOGNIZED",
    }))
);

addSheet("All vendors", vendors.map(vendorRow));

XLSX.writeFile(wb, outputPath);

console.log(`pins read: ${plan.totalPins}`);
console.log(`canadian skipped: ${excludedCanadian.length}`);
console.log(`vendors: ${vendors.length} (merged ${plan.totalPins - excludedCanadian.length - vendors.length})`);
console.log("by tier:", Object.fromEntries(byTier));
console.log("locations:", Object.fromEntries(byLocation));
console.log(`needs review: ${needsReview.length}`);
console.log(`services blank: ${blankServices}; unrecognized service wordings: ${[...serviceCounts.keys()].filter((t) => categorizeService(t).length === 0).length}`);
console.log(`duplicate groups: merged ${duplicateGroups.filter((g) => g.decision === "merged").length}, review ${duplicateGroups.filter((g) => g.decision === "needs_review").length}`);
console.log(`wrote ${outputPath}`);

// DRY RUN, round 2 — applies the decisions written into the "Revision" column
// of the reviewed workbook to the vendor plan, and writes a new Excel preview of
// the result. Reads files only; connects to nothing and saves nothing.
//
// Usage:
//   npx tsx scripts/vendor-apply-revisions.ts "<map.kmz>" "<revised.xlsx>" "<output.xlsx>" "<map-update-list.xlsx>"

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { kmlTextFromBytes, parseMyMapsKml } from "../src/lib/vendorImport/parseMyMaps";
import { buildImportPlan } from "../src/lib/vendorImport/buildVendors";
import { applyDecisions, applyRevisions, type ReviewDecisions, type RevisionRow } from "../src/lib/vendorImport/applyRevisions";
import { tierFromStatus } from "../src/lib/vendorImport/normalize";
import { TIER_LABEL, vendorRow } from "../src/lib/vendorImport/reportRows";

const [kmzPath, revisedPath, outputPath, mapUpdatePath] = process.argv.slice(2);
if (!kmzPath || !revisedPath || !outputPath || !mapUpdatePath) {
  console.error('Usage: npx tsx scripts/vendor-apply-revisions.ts "<map.kmz>" "<revised.xlsx>" "<output.xlsx>" "<map-update-list.xlsx>"');
  process.exit(1);
}

const plan = buildImportPlan(parseMyMapsKml(kmlTextFromBytes(new Uint8Array(readFileSync(kmzPath)))));

const revisedWb = XLSX.readFile(revisedPath);
const rows: RevisionRow[] = [];
for (const sheet of ["Needs review", "DNC name conflicts"] as const) {
  XLSX.utils.sheet_to_json<Record<string, unknown>>(revisedWb.Sheets[sheet], { defval: "" }).forEach((cells, i) => {
    rows.push({ sheet, excelRow: i + 2, cells });
  });
}

const decisions = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vendor-review-decisions.json"), "utf8")
) as ReviewDecisions;
const revisionPass = applyRevisions(plan, rows);
const { result, removedPerReview } = applyDecisions(revisionPass, decisions);
const { vendors, excludedCanadian } = result.plan;

const count = <T,>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return m;
};
const byTier = count(vendors, (v) => TIER_LABEL[v.tier]);
const byLocation = count(vendors, (v) => v.locationQuality);
const held = vendors.filter((v) => v.tier === "unclassified");
const needsLocation = vendors.filter((v) => v.locationQuality === "none");
const decidedByReview = vendors.filter((v) => v.tierSource === "review").length;
const duplicatesMerged = plan.totalPins - plan.excludedCanadian.length - plan.vendors.length + result.removedAsDuplicate.length;
const removedCount = removedPerReview.length;

const summary: (string | number)[][] = [
  ["VENDOR IMPORT — PREVIEW AFTER YOUR REVISIONS (nothing has been saved anywhere)", ""],
  ["", ""],
  ["Pins read from the map", plan.totalPins],
  ["Canadian vendors removed", excludedCanadian.length],
  ["Vendors removed per your review ('not found')", removedCount],
  ["Duplicate pins merged into one vendor", duplicatesMerged],
  ["Vendors that would be created", vendors.length],
  ["", ""],
  ["BY TIER", ""],
  ...[...byTier.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [`  ${k}`, n]),
  ["  (tier decided by your review rather than the map)", decidedByReview],
  ["", ""],
  ["LOCATIONS", ""],
  ["  Coordinates already known", (byLocation.get("point") ?? 0) + (byLocation.get("latlong_in_address") ?? 0)],
  ["  Street address (one-time lookup, within Google's free allowance)", byLocation.get("street_address") ?? 0],
  ["  City/state only (approximate)", byLocation.get("city_only") ?? 0],
  ["  No usable location", byLocation.get("none") ?? 0],
  ["", ""],
  ["YOUR REVISIONS", ""],
  ["  Revision rows read", result.stats.revisionRowsRead],
  ["  Rows that could not be matched to a vendor", result.stats.rowsUnmatched],
  ["  Changes applied", result.changes.length],
  ["  Items still needing your answer (see 'Open questions')", result.open.length],
];

const wb = XLSX.utils.book_new();
const addSheet = (name: string, data: Record<string, unknown>[]) => {
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "(none)": "" }]);
  const cols = Object.keys(data[0] ?? { "(none)": "" });
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(60, Math.max(12, c.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
};
const summaryWs = XLSX.utils.aoa_to_sheet(summary);
summaryWs["!cols"] = [{ wch: 78 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

addSheet(
  "Open questions",
  result.open.map((o) => ({ Vendor: o.vendor, Phone: o.phone, "What I need from you": o.issue, "Your note": o.yourNote }))
);
addSheet(
  "Changes applied",
  result.changes.map((c) => ({ Vendor: c.vendor, Phone: c.phone, "What changed": c.change, "Based on": c.basedOn }))
);
addSheet(
  "DNC vendors",
  vendors
    .filter((v) => v.tier.startsWith("dnc_"))
    .sort((a, b) => b.tier.localeCompare(a.tier) || a.name.localeCompare(b.name))
    .map(vendorRow)
);
addSheet("Still held (no tier)", held.map(vendorRow));
addSheet("No usable location", needsLocation.map(vendorRow));
addSheet("Canadian (removed)", excludedCanadian.map(vendorRow));
addSheet("Removed per review", removedPerReview.map(vendorRow));
addSheet("All vendors", vendors.map(vendorRow));

XLSX.writeFile(wb, outputPath);

// ---- Google My Maps update list: make the map match the reviewed decisions ----
const LAYER_FOR_TIER: Record<string, string> = {
  preferred: "Preferred Vendors",
  non_preferred: "Non Pref Vendors",
  dnc_tier_1: "DNC Tier 1",
  dnc_tier_2: "DNC Tier 2",
  dnc_tier_3: "DNC Tier 3",
};
const STATUS_FOR_TIER: Record<string, string> = {
  preferred: "Preferred",
  non_preferred: "Non Preferred",
  dnc_tier_1: "DNC Tier 1",
  dnc_tier_2: "DNC Tier 2",
  dnc_tier_3: "DNC Tier 3",
};
const mapWb = XLSX.utils.book_new();
const addMapSheet = (name: string, data: Record<string, unknown>[]) => {
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "(nothing to change)": "" }]);
  const cols = Object.keys(data[0] ?? { "(nothing to change)": "" });
  ws["!cols"] = cols.map((c) => ({ wch: Math.min(60, Math.max(14, c.length + 2)) }));
  XLSX.utils.book_append_sheet(mapWb, ws, name);
};
const tierChanges = vendors.filter((v) => v.tierSource === "review" && tierFromStatus(v.statusRaw) !== v.tier);
addMapSheet(
  "1 Change status",
  tierChanges
    .sort((a, b) => a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name))
    .map((v) => ({
      "Pin name in the map": v.nameOriginal,
      Phone: vendorRow(v).Phone,
      "Layer(s) it is in now": v.layers.join(" + "),
      "Status in the map now": v.statusRaw || "(blank)",
      "Change Status to": STATUS_FOR_TIER[v.tier] ?? v.tier,
      "Suggested layer": LAYER_FOR_TIER[v.tier] ?? "",
      Reason: v.tierReason,
    }))
);
addMapSheet(
  "2 Clean up names",
  vendors
    .filter((v) => v.nameOriginal !== v.name && v.tierSource === "review")
    .map((v) => ({ "Pin name in the map now": v.nameOriginal, "Rename to": v.name, Phone: vendorRow(v).Phone }))
);
addMapSheet(
  "3 Add addresses",
  vendors
    .filter((v) => v.flags.includes("address_added_in_review"))
    .map((v) => ({ "Pin name in the map": v.nameOriginal, Phone: vendorRow(v).Phone, "Address to add": v.address }))
);
addMapSheet(
  "4 Delete from map",
  [
    ...excludedCanadian.map((v) => ({ "Pin name in the map": v.nameOriginal, Phone: vendorRow(v).Phone, "Layer(s)": v.layers.join(" + "), Why: "Canadian vendor" })),
    ...removedPerReview.map((v) => ({ "Pin name in the map": v.nameOriginal, Phone: vendorRow(v).Phone, "Layer(s)": v.layers.join(" + "), Why: "Vendor not found" })),
    ...result.removedAsDuplicate.map((v) => ({ "Pin name in the map": v.nameOriginal, Phone: vendorRow(v).Phone, "Layer(s)": v.layers.join(" + "), Why: "Duplicate entry you marked for removal/merging" })),
  ]
);
XLSX.writeFile(mapWb, mapUpdatePath);

console.log(`map update list: ${tierChanges.length} status changes -> ${mapUpdatePath}`);
console.log(`pins: ${plan.totalPins} | removed per review: ${removedCount} | canadian removed: ${excludedCanadian.length} | duplicates merged: ${duplicatesMerged} | vendors: ${vendors.length}`);
console.log("tiers:", Object.fromEntries(byTier));
console.log("locations:", Object.fromEntries(byLocation));
console.log(`revision rows: ${result.stats.revisionRowsRead}, unmatched: ${result.stats.rowsUnmatched}, changes: ${result.changes.length}, open: ${result.open.length}, decided by review: ${decidedByReview}`);
console.log(`wrote ${outputPath}`);

// Shared by the preview and import scripts so both always work from exactly
// the same final vendor list: the map export, plus the decisions written in the
// reviewed workbook, plus the follow-up decisions in vendor-review-decisions.json.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { kmlTextFromBytes, parseMyMapsKml } from "../src/lib/vendorImport/parseMyMaps";
import { buildImportPlan, type ImportPlan, type VendorCandidate } from "../src/lib/vendorImport/buildVendors";
import {
  applyDecisions,
  applyRevisions,
  type ReviewDecisions,
  type RevisionResult,
  type RevisionRow,
} from "../src/lib/vendorImport/applyRevisions";

export interface FinalPlan {
  rawPlan: ImportPlan;
  result: RevisionResult;
  removedPerReview: VendorCandidate[];
}

export function buildFinalPlan(kmzPath: string, revisedXlsxPath: string): FinalPlan {
  const rawPlan = buildImportPlan(parseMyMapsKml(kmlTextFromBytes(new Uint8Array(readFileSync(kmzPath)))));

  const wb = XLSX.readFile(revisedXlsxPath);
  const rows: RevisionRow[] = [];
  for (const sheet of ["Needs review", "DNC name conflicts"] as const) {
    XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], { defval: "" }).forEach((cells, i) => {
      rows.push({ sheet, excelRow: i + 2, cells });
    });
  }

  const decisions = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vendor-review-decisions.json"), "utf8")
  ) as ReviewDecisions;

  const { result, removedPerReview } = applyDecisions(applyRevisions(rawPlan, rows), decisions);
  return { rawPlan, result, removedPerReview };
}

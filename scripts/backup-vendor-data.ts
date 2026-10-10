// Read-only backup of everything in the Hub that refers to vendors, taken
// before any vendor-database work: the vendor columns on every job and the
// whole job_contacted_vendors table. Writes CSV files; changes nothing.
//
// Usage:
//   set -a && source .env.local && set +a && npx tsx scripts/backup-vendor-data.ts "<output folder>"

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const outDir = process.argv[2];
if (!outDir) {
  console.error("Pass an output folder as the first argument.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

async function fetchAll(table: string, columns: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return all;
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const jobs = await fetchAll(
    "jobs",
    "id, job_number, report_id, agent, job_status, state, vendor_name, preferred_vendor, vendors_fee, vendor_eta"
  );
  writeFileSync(join(outDir, "jobs-vendor-fields.csv"), toCsv(jobs));

  const contacted = await fetchAll("job_contacted_vendors", "*");
  writeFileSync(join(outDir, "job-contacted-vendors.csv"), toCsv(contacted));

  console.log(`jobs-vendor-fields.csv: ${jobs.length} rows`);
  console.log(`job-contacted-vendors.csv: ${contacted.length} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

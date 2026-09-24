// One-time backfill: create/match a Lead for every existing job's customer,
// deduping repeat customers onto a single Lead, and link jobs.lead_id.
// Safe to re-run — only ever processes jobs where lead_id is still null.
//
// Usage:
//   set -a && source .env.local && set +a && npx tsx scripts/backfill-job-leads.ts
//   (add --dry-run to only print the summary, without writing anything)

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, normalizeName, normalizePhone, findOrCreateLeadForJob } from "../src/lib/leadMatching";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

interface JobRow {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  client_email: string | null;
  state: string | null;
  agent: string | null;
  dispatcher: string | null;
  time_converted: string | null;
}

const PAGE_SIZE = 1000;

async function fetchJobsNeedingLead(): Promise<JobRow[]> {
  const rows: JobRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, customer_name, customer_phone, client_email, state, agent, dispatcher, time_converted")
      .is("lead_id", null)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as JobRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

function keyFor(job: JobRow): string | null {
  const phone = normalizePhone(job.customer_phone);
  if (phone) return `phone:${phone}`;
  const email = normalizeEmail(job.client_email);
  if (email) return `email:${email}`;
  const name = normalizeName(job.customer_name);
  if (name) return `name:${name}`;
  return null;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  console.log(DRY_RUN ? "Running in --dry-run mode (no writes will happen).\n" : "Running for real — this will write to production.\n");

  console.log("Fetching jobs with no lead_id...");
  const jobs = await fetchJobsNeedingLead();
  console.log(`Fetched ${jobs.length} jobs.`);

  const groups = new Map<string, JobRow[]>();
  let skipped = 0;
  for (const job of jobs) {
    const key = keyFor(job);
    if (!key) {
      skipped++;
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }

  const multiJobGroups = Array.from(groups.values()).filter((g) => g.length > 1).length;
  console.log(`Grouped into ${groups.size} distinct customers (${multiJobGroups} with 2+ jobs).`);
  console.log(`${skipped} jobs skipped (no usable phone/email/name) — will be left unlinked.\n`);

  if (DRY_RUN) {
    console.log("Dry run complete — no leads created, no jobs updated.");
    return;
  }

  const groupEntries = Array.from(groups.values());
  let created = 0;
  let matched = 0;
  let jobsLinked = 0;
  let errors = 0;

  await mapWithConcurrency(groupEntries, 20, async (groupJobs) => {
    const representative = [...groupJobs].sort((a, b) =>
      (b.time_converted ?? "").localeCompare(a.time_converted ?? "")
    )[0];

    const result = await findOrCreateLeadForJob(supabase, {
      customerName: representative.customer_name,
      customerPhone: representative.customer_phone,
      email: representative.client_email,
      agent: representative.agent,
      dispatcher: representative.dispatcher,
      state: representative.state,
      jobId: representative.id,
      jobTimeConverted: representative.time_converted,
    });

    if ("error" in result) {
      console.error(`Failed to find/create lead for job ${representative.id}: ${result.error}`);
      errors++;
      return;
    }

    if (result.created) created++;
    else matched++;

    const jobIds = groupJobs.map((j) => j.id);
    const { error: updateError } = await supabase.from("jobs").update({ lead_id: result.leadId }).in("id", jobIds);
    if (updateError) {
      console.error(`Failed to link ${jobIds.length} job(s) to lead ${result.leadId}: ${updateError.message}`);
      errors++;
      return;
    }
    jobsLinked += jobIds.length;
  });

  console.log("\nDone.");
  console.log(`  Leads created:   ${created}`);
  console.log(`  Leads matched:   ${matched}`);
  console.log(`  Jobs linked:     ${jobsLinked}`);
  console.log(`  Jobs skipped:    ${skipped}`);
  console.log(`  Errors:          ${errors}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

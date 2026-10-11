import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getAgentNameOptions } from "@/lib/profile";
import { LEAD_DISPOSITIONS } from "@/lib/constants";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import LeadsTable, { type Lead } from "./LeadsTable";
import CreateLeadButton from "./CreateLeadButton";

const PAGE_SIZE = 50;

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Characters that would change the meaning of a PostgREST filter string.
const clean = (s: string) => s.replace(/[%,()*\\]/g, " ").trim();

function hrefWith(params: Record<string, string>, page: number) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/leads?${s}` : "/leads";
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/10 p-3">
      <div className="text-xs text-black/50">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const filters = { q: one(sp.q), status: one(sp.status) };
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const supabase = await createClient();

  // Everything below runs at the same time. Only the current page of leads is
  // ever fetched; the totals are counted by the database, not by downloading
  // every lead and counting in the browser.
  const count = (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => build(base()).then((r) => r.count ?? 0);
  const base = () => supabase.from("leads").select("id", { count: "exact", head: true });

  let listQuery = supabase.from("leads").select("*", { count: "exact" });
  if (["open", "converted", "lost"].includes(filters.status)) listQuery = listQuery.eq("status", filters.status);
  const q = clean(filters.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const parts = ["lead_number", "agent", "customer_name", "notes", "job_type", "year_make_model"].map(
      (c) => `${c}.ilike.%${q}%`
    );
    parts.push(`customer_phone.ilike.%${q}%`);
    if (digits.length >= 4) parts.push(`phone_normalized.ilike.%${digits}%`);
    listQuery = listQuery.or(parts.join(","));
  }
  const from = (page - 1) * PAGE_SIZE;

  const [list, profile, agentOptions, total, converted, lost, ...dispositionCounts] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    getCurrentProfile(),
    getAgentNameOptions(),
    count((b) => b),
    count((b) => b.eq("status", "converted")),
    count((b) => b.eq("status", "lost")),
    ...LEAD_DISPOSITIONS.map((d) => count((b) => b.eq("disposition", d))),
  ]);

  const leads = (list.data ?? []) as Lead[];
  const matching = list.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(matching / PAGE_SIZE));
  const closed = converted + lost;
  const conversionRate = closed > 0 ? `${Math.round((converted / closed) * 100)}%` : "-";
  const dispositionRows = LEAD_DISPOSITIONS.map((d, i) => ({ disposition: d, count: dispositionCounts[i] })).filter(
    (d) => d.count > 0
  );

  const params: Record<string, string> = { ...filters };

  return (
    <div className="space-y-8">
      <RealtimeRefresh tables={["leads"]} />

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Leads</h1>
        <CreateLeadButton
          agentOptions={agentOptions}
          currentRole={profile?.role}
          currentAgentName={profile?.agent_name}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card label="Total leads" value={total} />
        <Card label="Open" value={total - closed} />
        <Card label="Converted" value={converted} />
        <Card label="Lost" value={lost} />
        <Card label="Conversion rate" value={conversionRate} />
      </div>

      {dispositionRows.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Why leads are lost</h2>
          <div className="overflow-hidden rounded-lg border border-black/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Disposition</th>
                  <th className="px-4 py-2 font-medium">Leads</th>
                </tr>
              </thead>
              <tbody>
                {dispositionRows.map((d) => (
                  <tr key={d.disposition} className="border-t border-black/10">
                    <td className="px-4 py-2">{d.disposition}</td>
                    <td className="px-4 py-2">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">All leads ({total.toLocaleString("en-US")})</h2>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Search lead #, agent, customer, phone, service..."
            className="w-72 rounded border border-black/20 px-3 py-1.5 text-sm"
          />
          <select
            name="status"
            defaultValue={filters.status}
            className="rounded border border-black/20 px-2 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="converted">Converted</option>
            <option value="lost">Lost</option>
          </select>
          <button type="submit" className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white">
            Search
          </button>
          <Link href="/leads" className="pb-1.5 text-sm underline">
            Clear
          </Link>
          <span className="pb-1.5 text-xs text-black/50">
            {matching.toLocaleString("en-US")} match{matching === 1 ? "" : "es"}
            {totalPages > 1 && ` — page ${page} of ${totalPages}`}
          </span>
        </form>

        <LeadsTable
          leads={leads}
          agentOptions={agentOptions}
          currentRole={profile?.role}
          currentAgentName={profile?.agent_name}
        />

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            {page > 1 ? (
              <Link href={hrefWith(params, page - 1)} className="underline">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Link href={hrefWith(params, page + 1)} className="underline">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

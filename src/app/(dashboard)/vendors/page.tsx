import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_CATEGORIES } from "@/lib/vendorImport/normalize";
import {
  SERVICE_LABELS,
  TIER_LABELS,
  VENDOR_TIERS,
  formatPhoneDisplay,
  type Vendor,
  type VendorTier,
} from "@/lib/vendors";
import { US_STATE_CODES } from "@/lib/constants";
import { TierBadge } from "./TierBadge";
import AddVendorButton from "./AddVendorButton";

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
  return s ? `/vendors?${s}` : "/vendors";
}

export default async function VendorsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const filters = {
    q: one(sp.q),
    tier: one(sp.tier),
    state: one(sp.state),
    service: one(sp.service),
    location: one(sp.location),
    heavy: one(sp.heavy),
    inactive: one(sp.inactive),
  };
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const supabase = await createClient();

  let query = supabase
    .from("vendors")
    .select(
      "id, name, tier, phone, address, state, service_categories, heavy_duty_capable, heavy_duty_only, location_quality, is_active",
      { count: "exact" }
    );

  if (!filters.inactive) query = query.eq("is_active", true);
  if (filters.tier && (VENDOR_TIERS as readonly string[]).includes(filters.tier)) query = query.eq("tier", filters.tier);
  if (filters.state) query = query.eq("state", filters.state);
  if (filters.service && (SERVICE_CATEGORIES as readonly string[]).includes(filters.service)) {
    query = query.contains("service_categories", [filters.service]);
  }
  if (filters.location === "has") query = query.not("latitude", "is", null);
  if (filters.location === "lookup") query = query.eq("needs_geocode", true);
  if (filters.location === "none") query = query.eq("location_quality", "none");
  if (filters.heavy) query = query.eq("heavy_duty_capable", true);

  const q = clean(filters.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    const parts = [`name.ilike.%${q}%`, `address.ilike.%${q}%`, `email.ilike.%${q}%`];
    if (digits.length >= 4) parts.push(`phone.ilike.%${digits}%`);
    query = query.or(parts.join(","));
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.order("name", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  const vendors = (data ?? []) as Pick<
    Vendor,
    "id" | "name" | "tier" | "phone" | "address" | "state" | "service_categories" | "heavy_duty_capable" | "heavy_duty_only" | "location_quality" | "is_active"
  >[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Tier totals across all active vendors (ignores the filters on purpose).
  const tierCounts = await Promise.all(
    VENDOR_TIERS.map(async (t) => {
      const { count: c } = await supabase
        .from("vendors")
        .select("id", { count: "exact", head: true })
        .eq("tier", t)
        .eq("is_active", true);
      return [t, c ?? 0] as const;
    })
  );

  const params: Record<string, string> = { ...filters };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Vendors</h1>
        <AddVendorButton />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tierCounts.map(([t, n]) => (
          <Link
            key={t}
            href={hrefWith({ ...params, tier: filters.tier === t ? "" : t }, 1)}
            className={`rounded-lg border p-3 hover:bg-black/[0.03] ${filters.tier === t ? "border-black" : "border-black/10"}`}
          >
            <div className="text-xs text-black/50">{TIER_LABELS[t as VendorTier]}</div>
            <div className="mt-1 text-base font-semibold">{n.toLocaleString("en-US")}</div>
          </Link>
        ))}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-black/60">Search</span>
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Name, phone, address, email..."
            className="w-64 rounded border border-black/20 px-3 py-1.5 text-sm"
          />
        </label>
        <Select name="tier" label="Tier" value={filters.tier} options={VENDOR_TIERS.map((t) => [t, TIER_LABELS[t]])} />
        <Select name="state" label="State" value={filters.state} options={US_STATE_CODES.map((s) => [s, s])} />
        <Select
          name="service"
          label="Service"
          value={filters.service}
          options={SERVICE_CATEGORIES.map((s) => [s, SERVICE_LABELS[s]])}
        />
        <Select
          name="location"
          label="Location"
          value={filters.location}
          options={[
            ["has", "Has coordinates"],
            ["lookup", "Needs address lookup"],
            ["none", "No usable location"],
          ]}
        />
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="heavy" value="1" defaultChecked={!!filters.heavy} />
          Heavy-duty
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="inactive" value="1" defaultChecked={!!filters.inactive} />
          Include inactive
        </label>
        <button type="submit" className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white">
          Apply
        </button>
        <Link href="/vendors" className="pb-2 text-sm underline">
          Clear
        </Link>
      </form>

      <div className="text-xs text-black/50">
        {total.toLocaleString("en-US")} vendor{total === 1 ? "" : "s"}
        {totalPages > 1 && ` — page ${page} of ${totalPages}`}
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Vendor</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Tier</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Phone</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Location</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Services</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className={`border-t border-black/10 hover:bg-black/[0.03] ${v.is_active ? "" : "opacity-50"}`}>
                <td className="px-3 py-2">
                  <Link href={`/vendors/${v.id}`} className="font-medium underline">
                    {v.name}
                  </Link>
                  {!v.is_active && <span className="ml-2 text-xs text-black/50">(inactive)</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <TierBadge tier={v.tier} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">{formatPhoneDisplay(v.phone) || "-"}</td>
                <td className="max-w-xs truncate px-3 py-2" title={v.address ?? ""}>
                  {v.location_quality === "none" ? <span className="text-black/40">No location</span> : (v.address ?? "-")}
                </td>
                <td className="max-w-sm px-3 py-2 text-xs text-black/70">
                  {v.service_categories.length > 0
                    ? v.service_categories
                        .slice(0, 4)
                        .map((c) => SERVICE_LABELS[c as keyof typeof SERVICE_LABELS] ?? c)
                        .join(", ") + (v.service_categories.length > 4 ? ` +${v.service_categories.length - 4}` : "")
                    : <span className="text-black/40">Services not listed</span>}
                  {v.heavy_duty_only && <span className="ml-1 rounded bg-black/10 px-1">HD only</span>}
                </td>
              </tr>
            ))}
            {vendors.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-black/50">
                  No vendors match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
  );
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: (readonly [string, string])[] | (string[])[];
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-black/60">{label}</span>
      <select name={name} defaultValue={value} className="rounded border border-black/20 px-2 py-1.5 text-sm">
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

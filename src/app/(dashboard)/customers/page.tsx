import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatPhoneDisplay } from "@/lib/vendors";

const PAGE_SIZE = 50;
type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
// Characters that would change the meaning of a PostgREST filter string.
const clean = (s: string) => s.replace(/[%,()*\\]/g, " ").trim();

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const q = clean(one(sp.q));
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, name, company, phone, email, created_at", { count: "exact" });
  if (q) {
    const digits = q.replace(/\D/g, "");
    const parts = [`name.ilike.%${q}%`, `company.ilike.%${q}%`, `email.ilike.%${q}%`];
    if (digits.length >= 4) parts.push(`phone_normalized.ilike.%${digits}%`);
    query = query.or(parts.join(","));
  }
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const customers = data ?? [];
  const total = count ?? customers.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/customers?${s}` : "/customers";
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Customers</h1>
        <p className="text-sm text-black/60">
          Every customer with all of their leads, jobs and correspondence in one place. Open a customer to see their
          full history or to send them a text or email.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name, company, phone or email…"
          className="w-80 rounded border border-black/20 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded bg-black px-4 py-1.5 text-sm font-medium text-white">
          Search
        </button>
        <Link href="/customers" className="pb-1.5 text-sm underline">
          Clear
        </Link>
        <span className="pb-1.5 text-xs text-black/50">
          {total.toLocaleString("en-US")} customer{total === 1 ? "" : "s"}
          {totalPages > 1 && ` — page ${page} of ${totalPages}`}
        </span>
      </form>

      <div className="overflow-hidden rounded-lg border border-black/10">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Phone</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-black/50">
                  No customers found.
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-black/10 hover:bg-black/[0.03]">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/customers/${c.id}`} className="hover:underline">
                    {c.name || "Unnamed"}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.company ?? ""}</td>
                <td className="px-4 py-2">{c.phone ? formatPhoneDisplay(c.phone.replace(/\D/g, "").replace(/^1(\d{10})$/, "$1")) : <span className="text-black/40">none</span>}</td>
                <td className="px-4 py-2">{c.email ?? <span className="text-black/40">none</span>}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/customers/${c.id}`} className="underline">
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className="underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {page < totalPages ? (
            <Link href={hrefFor(page + 1)} className="underline">
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

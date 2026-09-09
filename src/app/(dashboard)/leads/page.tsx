import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getAgentNameOptions } from "@/lib/profile";
import { LEAD_DISPOSITIONS } from "@/lib/constants";
import { fetchAllRows } from "@/lib/supabase/paginate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import LeadsTable, { type Lead } from "./LeadsTable";
import CreateLeadButton from "./CreateLeadButton";

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/10 p-3">
      <div className="text-xs text-black/50">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

export default async function LeadsPage() {
  const supabase = await createClient();
  const leadList = await fetchAllRows<Lead>(() =>
    supabase.from("leads").select("*").order("created_at", { ascending: false })
  );
  const profile = await getCurrentProfile();
  const agentOptions = await getAgentNameOptions();

  const total = leadList.length;
  const converted = leadList.filter((l) => l.status === "converted").length;
  const lost = leadList.filter((l) => l.status === "lost").length;
  const closed = converted + lost;
  const conversionRate = closed > 0 ? `${Math.round((converted / closed) * 100)}%` : "-";

  const dispositionCounts = LEAD_DISPOSITIONS.map((d) => ({
    disposition: d,
    count: leadList.filter((l) => l.disposition === d).length,
  })).filter((d) => d.count > 0);

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

      {dispositionCounts.length > 0 && (
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
                {dispositionCounts.map((d) => (
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

      <div>
        <h2 className="mb-2 text-sm font-semibold">All leads ({leadList.length})</h2>
        <LeadsTable
          leads={leadList}
          agentOptions={agentOptions}
          currentRole={profile?.role}
          currentAgentName={profile?.agent_name}
        />
      </div>
    </div>
  );
}

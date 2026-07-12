import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isSupervisor } from "@/lib/profile";
import { dateInPHT, todayISO, weekRangeFor } from "@/lib/aggregate";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ClockWidget from "./ClockWidget";

interface TimeEntry {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
}

function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatHours(ms: number) {
  return `${(ms / 3600000).toFixed(2)}h`;
}

function durationMs(e: TimeEntry): number {
  const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
  return end - new Date(e.clock_in).getTime();
}

function groupByDate(entries: TimeEntry[]) {
  const byDate = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const d = dateInPHT(e.clock_in);
    const list = byDate.get(d) ?? [];
    list.push(e);
    byDate.set(d, list);
  }
  return Array.from(byDate.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
}

export default async function HoursPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getCurrentProfile();

  const { data: myEntries } = await supabase
    .from("time_entries")
    .select("id, user_id, clock_in, clock_out")
    .eq("user_id", user.id)
    .order("clock_in", { ascending: false });

  const entries = (myEntries ?? []) as TimeEntry[];
  const openEntry = entries.find((e) => !e.clock_out) ?? null;

  const today = todayISO();
  const { start: weekStart, end: weekEnd } = weekRangeFor(today);
  const weekMs = entries
    .filter((e) => {
      const d = dateInPHT(e.clock_in);
      return d >= weekStart && d <= weekEnd;
    })
    .reduce((sum, e) => sum + durationMs(e), 0);

  const grouped = groupByDate(entries);

  let allSection = null;
  if (isSupervisor(profile?.role)) {
    const { data: allEntries } = await supabase
      .from("time_entries")
      .select("id, user_id, clock_in, clock_out")
      .order("clock_in", { ascending: false })
      .limit(500);

    const { data: profiles } = await supabase.from("profiles").select("id, agent_name, email, role");

    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id, p.agent_name || p.email || p.role])
    );

    const byUser = new Map<string, TimeEntry[]>();
    for (const e of (allEntries ?? []) as TimeEntry[]) {
      const list = byUser.get(e.user_id) ?? [];
      list.push(e);
      byUser.set(e.user_id, list);
    }

    allSection = (
      <div>
        <h2 className="mb-2 text-sm font-semibold">All agents</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Total hours (last 500 entries)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(byUser.entries()).map(([userId, userEntries]) => {
                const totalMs = userEntries.reduce((sum, e) => sum + durationMs(e), 0);
                const open = userEntries.find((e) => !e.clock_out);
                return (
                  <tr key={userId} className="border-t border-black/10">
                    <td className="px-4 py-2">{nameById.get(userId) ?? userId}</td>
                    <td className="px-4 py-2">
                      {open ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Clocked in
                        </span>
                      ) : (
                        <span className="text-black/40">Clocked out</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{formatHours(totalMs)}</td>
                  </tr>
                );
              })}
              {byUser.size === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-black/50">
                    No entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <RealtimeRefresh tables={["time_entries"]} />
      <div>
        <h1 className="text-lg font-semibold">Hours</h1>
        <p className="text-sm text-black/60">
          Clock in when you start working, clock out when you&apos;re done.
        </p>
      </div>

      <ClockWidget
        openEntry={openEntry ? { id: openEntry.id, clock_in: openEntry.clock_in } : null}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-black/10 p-3">
          <div className="text-xs text-black/50">This week</div>
          <div className="mt-1 text-base font-semibold">{formatHours(weekMs)}</div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">History</h2>
        {grouped.length === 0 && <p className="text-sm text-black/50">No entries yet.</p>}
        <div className="space-y-4">
          {grouped.map(([date, dayEntries]) => {
            const dayTotal = dayEntries.reduce((sum, e) => sum + durationMs(e), 0);
            return (
              <div key={date}>
                <div className="mb-1 flex items-center justify-between text-sm font-medium">
                  <span>{formatDate(date)}</span>
                  <span className="text-black/50">{formatHours(dayTotal)}</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-black/10">
                  <table className="w-full text-sm">
                    <thead className="bg-black/5 text-left">
                      <tr>
                        <th className="px-4 py-2 font-medium">Clock in</th>
                        <th className="px-4 py-2 font-medium">Clock out</th>
                        <th className="px-4 py-2 font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayEntries.map((e) => (
                        <tr key={e.id} className="border-t border-black/10">
                          <td className="px-4 py-2">
                            {new Date(e.clock_in).toLocaleTimeString("en-US")}
                          </td>
                          <td className="px-4 py-2">
                            {e.clock_out ? new Date(e.clock_out).toLocaleTimeString("en-US") : "-"}
                          </td>
                          <td className="px-4 py-2">{formatHours(durationMs(e))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {allSection}
    </div>
  );
}

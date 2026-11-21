"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, getRoster, isFullAdmin, isSupervisor } from "@/lib/profile";
import { dateInPHT, todayISO, weekRangeFor } from "@/lib/aggregate";
import { emailConfig } from "@/lib/email/send";
import { ROLE_MENU_LABELS } from "@/lib/roles";

// What the top-bar Messages and Profile menus read. Everything here is read
// with the signed-in person's own access, so nobody sees more than the rest of
// the Hub already lets them see.

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type ShellMessage = {
  id: string;
  channel: "email" | "sms";
  direction: "outbound" | "inbound";
  partyType: "customer" | "vendor" | "other";
  name: string;
  preview: string;
  createdAt: string;
  unread: boolean;
  href: string | null;
  linkLabel: string;
};

export type MessagePanelData = {
  messages: ShellMessage[];
  unreadCount: number;
  emailConnected: boolean;
  smsConnected: boolean;
};

type MessageRow = {
  id: string;
  channel: "email" | "sms";
  direction: "outbound" | "inbound";
  party_type: "customer" | "vendor" | "other";
  party_name: string | null;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  body: string;
  created_at: string;
  read_at?: string | null;
  job_id: string | null;
  lead_id: string | null;
  customer_id: string | null;
  vendor_id: string | null;
  lead: { lead_number: string } | null;
  job: { job_number: string | null; report_id: string } | null;
};

const BASE_COLUMNS =
  "id, channel, direction, party_type, party_name, from_address, to_address, subject, body, created_at, job_id, lead_id, customer_id, vendor_id, lead:leads(lead_number), job:jobs(job_number, report_id)";

export async function getUnreadCount(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("communications")
    .select("id", { count: "exact", head: true })
    .eq("direction", "inbound")
    .is("read_at", null);
  // Before the unread column exists this simply shows no badge.
  return error ? 0 : (count ?? 0);
}

export async function getMessagePanel(): Promise<MessagePanelData | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };
  const supabase = await createClient();

  let readTracking = true;
  let data: unknown[] | null = null;
  const withRead = await supabase
    .from("communications")
    .select(`${BASE_COLUMNS}, read_at`)
    .order("created_at", { ascending: false })
    .limit(40);
  if (!withRead.error) {
    data = withRead.data;
  } else {
    // The unread column isn't there yet: show the messages without unread markers.
    readTracking = false;
    const without = await supabase.from("communications").select(BASE_COLUMNS).order("created_at", { ascending: false }).limit(40);
    if (without.error) return { error: "Couldn't load messages." };
    data = without.data;
  }

  const rows = (data ?? []) as unknown as MessageRow[];
  const messages: ShellMessage[] = rows.map((r) => {
    let href: string | null = null;
    let linkLabel = "Message";
    if (r.job_id && r.job) {
      href = `/reports/${r.job.report_id}/jobs/${r.job_id}`;
      linkLabel = `Job ${r.job.job_number ?? ""}`.trim();
    } else if (r.lead_id) {
      href = `/leads/${r.lead_id}`;
      linkLabel = `Lead ${r.lead?.lead_number ?? ""}`.trim();
    } else if (r.customer_id) {
      href = `/customers/${r.customer_id}`;
      linkLabel = "Customer profile";
    } else if (r.vendor_id) {
      href = `/vendors/${r.vendor_id}`;
      linkLabel = "Vendor profile";
    }
    const name = r.party_name || (r.direction === "inbound" ? r.from_address : r.to_address) || "Unknown";
    const text = r.subject ? `${r.subject}: ${r.body}` : r.body;
    return {
      id: r.id,
      channel: r.channel,
      direction: r.direction,
      partyType: r.party_type,
      name,
      preview: text.replace(/\s+/g, " ").slice(0, 220),
      createdAt: r.created_at,
      unread: readTracking && r.direction === "inbound" && !r.read_at,
      href,
      linkLabel,
    };
  });

  return {
    messages,
    unreadCount: await getUnreadCount(),
    emailConnected: !!emailConfig(),
    smsConnected: false, // no text-message provider is connected yet
  };
}

export async function markMessageRead(id: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown message." };
  const supabase = await createClient();
  // Only a message this person is allowed to see can be marked.
  const { data } = await supabase.from("communications").select("id").eq("id", id).maybeSingle();
  if (!data) return { error: "You don't have access to this message." };
  const admin = createAdminClient();
  await admin.from("communications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
  return { success: true };
}

export async function markAllMessagesRead(): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("communications")
    .select("id")
    .eq("direction", "inbound")
    .is("read_at", null)
    .limit(500);
  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) return { success: true };
  const admin = createAdminClient();
  await admin.from("communications").update({ read_at: new Date().toISOString() }).in("id", ids);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type ProfilePerson = { name: string; role: string; hours: string | null; clockedIn: boolean | null };
export type ProfileUser = { name: string; role: string };

export type ProfilePanelData = {
  todayHours: string;
  weekHours: string;
  clockedInSince: string | null;
  // Team Lead, Admin and Owner: the people who have a login (clocked-in first),
  // plus how many are on the Agents & Dispatchers list in all.
  team: ProfilePerson[] | null;
  teamTotal: number;
  teamClockedIn: number;
  users: ProfileUser[] | null; // Owner only
  canManageTeam: boolean;
  canManageUsers: boolean;
};

type Entry = { id: string; user_id: string; clock_in: string; clock_out: string | null };

function durationMs(e: Entry): number {
  const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
  return Math.max(0, end - new Date(e.clock_in).getTime());
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export async function getProfilePanel(): Promise<ProfilePanelData | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };
  const profile = await getCurrentProfile();
  const role = profile?.role;
  const supabase = await createClient();

  const today = todayISO();
  const week = weekRangeFor(today);
  const weekStart = new Date(`${week.start}T00:00:00+08:00`).toISOString();
  const todayStart = new Date(`${today}T00:00:00+08:00`).toISOString();

  // ---- The signed-in person's own hours ----
  const { data: mine } = await supabase
    .from("time_entries")
    .select("id, user_id, clock_in, clock_out")
    .eq("user_id", user.id)
    .gte("clock_in", weekStart);
  const myEntries = (mine ?? []) as Entry[];
  const sumMs = (list: Entry[]) => list.reduce((s, e) => s + durationMs(e), 0);
  const todayMine = myEntries.filter((e) => dateInPHT(e.clock_in) === today);
  const open = myEntries.find((e) => !e.clock_out) ?? null;

  const data: ProfilePanelData = {
    todayHours: formatDuration(sumMs(todayMine)),
    weekHours: formatDuration(sumMs(myEntries)),
    clockedInSince: open
      ? `${new Date(open.clock_in).toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })} PHT`
      : null,
    team: null,
    teamTotal: 0,
    teamClockedIn: 0,
    users: null,
    canManageTeam: isFullAdmin(role),
    canManageUsers: isFullAdmin(role),
  };

  // ---- Team Lead, Admin and Owner: the Agents / Dispatchers ----
  if (isSupervisor(role)) {
    const [roster, todayRes, openRes, profilesRes] = await Promise.all([
      getRoster(),
      supabase.from("time_entries").select("id, user_id, clock_in, clock_out").gte("clock_in", todayStart),
      supabase.from("time_entries").select("id, user_id, clock_in, clock_out").is("clock_out", null),
      // A Team Lead can't read other people's login records, but may see who on
      // the team is clocked in. Only names are read, and only after the role check above.
      createAdminClient().from("profiles").select("id, agent_name"),
    ]);
    const byId = new Map<string, Entry>();
    for (const e of [...((todayRes.data ?? []) as Entry[]), ...((openRes.data ?? []) as Entry[])]) byId.set(e.id, e);
    const entries = Array.from(byId.values());
    const userIdByName = new Map<string, string>();
    for (const p of profilesRes.data ?? []) {
      if (p.agent_name) userIdByName.set(String(p.agent_name).trim().toLowerCase(), p.id as string);
    }

    const activeRoster = roster.filter((r) => r.is_active);
    const people: ProfilePerson[] = [];
    for (const r of activeRoster) {
      const uid = userIdByName.get(r.name.trim().toLowerCase());
      if (!uid) continue; // no login, so no hours to show
      const label = r.is_agent && r.is_dispatcher ? "Agent / Dispatcher" : r.is_dispatcher ? "Dispatcher" : "Agent";
      const mineToday = entries.filter((e) => e.user_id === uid && dateInPHT(e.clock_in) === today);
      const clockedIn = entries.some((e) => e.user_id === uid && !e.clock_out);
      people.push({ name: r.name, role: label, hours: formatDuration(sumMs(mineToday)), clockedIn });
    }
    people.sort((a, b) => Number(b.clockedIn) - Number(a.clockedIn) || a.name.localeCompare(b.name));
    data.team = people;
    data.teamTotal = activeRoster.length;
    data.teamClockedIn = people.filter((p) => p.clockedIn).length;
  }

  // ---- Owner: every user in the system ----
  if (role === "operations_manager") {
    const { data: users } = await supabase.from("profiles").select("role, agent_name, email").order("agent_name");
    data.users = (users ?? []).map((u) => ({
      name: (u.agent_name as string | null) || (u.email as string | null) || "(no name)",
      role: ROLE_MENU_LABELS[u.role as string] ?? String(u.role),
    }));
  }

  return data;
}

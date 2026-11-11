import { cache } from "react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export { type Role, ALL_ROLES, isFullAdmin, isSupervisor } from "@/lib/roles";
import { isFullAdmin, isSupervisor, type Role } from "@/lib/roles";

export interface Profile {
  role: Role;
  agent_name: string | null;
}

// Shared across the layout, the page and any helper within one request.
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("role, agent_name")
    .eq("id", user.id)
    .single();

  return (data as Profile | null) ?? null;
});

export async function requireFullAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!isFullAdmin(data?.role as Role | undefined)) {
    return { ok: false, error: "Only Operations Managers and Admin Coordinators can do this." };
  }

  return { ok: true, userId: user.id };
}

export async function requireSupervisor(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!isSupervisor(data?.role as Role | undefined)) {
    return { ok: false, error: "Only supervisors can do this." };
  }

  return { ok: true, userId: user.id };
}

export type RosterEntry = {
  id: string;
  name: string;
  is_agent: boolean;
  is_dispatcher: boolean;
  is_active: boolean;
  notes: string | null;
  deactivated_at: string | null;
  created_at: string;
};

// The whole roster, shared by everything rendered in one request.
export const getRoster = cache(async (): Promise<RosterEntry[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_roster")
    .select("id, name, is_agent, is_dispatcher, is_active, notes, deactivated_at, created_at")
    .order("name");
  return (data ?? []) as RosterEntry[];
});

const sortNames = (names: string[]) => Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));

/** Active Agents on the roster — the names offered when assigning a lead or job. */
export async function getAgentNameOptions(): Promise<string[]> {
  return sortNames((await getRoster()).filter((r) => r.is_active && r.is_agent).map((r) => r.name));
}

/** Active Dispatchers on the roster. */
export async function getDispatcherNameOptions(): Promise<string[]> {
  return sortNames((await getRoster()).filter((r) => r.is_active && r.is_dispatcher).map((r) => r.name));
}

// Team leaders and admins: the people who can approve using a DNC Tier 1 or
// Tier 2 vendor.
export async function getApproverNameOptions(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("agent_name")
    .in("role", ["team_leader", "operations_manager", "admin_coordinator"]);
  return Array.from(new Set((data ?? []).map((p) => p.agent_name).filter((n): n is string => !!n))).sort();
}

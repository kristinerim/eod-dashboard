import { createClient } from "@/lib/supabase/server";
import { TEAM_MEMBERS } from "@/lib/constants";

export { type Role, ALL_ROLES, isFullAdmin, isSupervisor } from "@/lib/roles";
import { isFullAdmin, isSupervisor, type Role } from "@/lib/roles";

export interface Profile {
  role: Role;
  agent_name: string | null;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("role, agent_name")
    .eq("id", user.id)
    .single();

  return (data as Profile | null) ?? null;
}

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

/** The fixed team roster plus any agent accounts created later (new hires), deduped and sorted. */
export async function getAgentNameOptions(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("agent_name").eq("role", "agent");
  const dbNames = (data ?? [])
    .map((p) => p.agent_name)
    .filter((n): n is string => !!n);
  return Array.from(new Set([...TEAM_MEMBERS, ...dbNames])).sort();
}

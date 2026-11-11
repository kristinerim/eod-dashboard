"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFullAdmin } from "@/lib/profile";

type Result = { success: true } | { error: string };

export type TeamMemberInput = {
  name: string;
  isAgent: boolean;
  isDispatcher: boolean;
  notes: string;
};

const cleanName = (s: string) => s.replace(/\s+/g, " ").trim();

function validate(input: TeamMemberInput): { name: string; notes: string | null } | { error: string } {
  const name = cleanName(input.name ?? "");
  if (!name) return { error: "Enter a name." };
  if (name.length > 80) return { error: "That name is too long." };
  if (!input.isAgent && !input.isDispatcher) return { error: "Choose Agent, Dispatcher, or both." };
  const notes = (input.notes ?? "").trim().slice(0, 500);
  return { name, notes: notes || null };
}

// A name that someone else already has, ignoring capitals.
async function nameTaken(supabase: Awaited<ReturnType<typeof createClient>>, name: string, exceptId?: string) {
  const { data } = await supabase.from("team_roster").select("id, name");
  return (data ?? []).some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
}

// Everything below is limited to Operations Managers and Admin Coordinators,
// twice over: here, and by the database's own rules on the roster table.

export async function addTeamMember(input: TeamMemberInput): Promise<Result> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };
  const v = validate(input);
  if ("error" in v) return v;

  const supabase = await createClient();
  if (await nameTaken(supabase, v.name)) return { error: `${v.name} is already on the list.` };

  const { error } = await supabase.from("team_roster").insert({
    name: v.name,
    is_agent: input.isAgent,
    is_dispatcher: input.isDispatcher,
    notes: v.notes,
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: true };
}

export async function updateTeamMember(id: string, input: TeamMemberInput): Promise<Result> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };
  const v = validate(input);
  if ("error" in v) return v;

  const supabase = await createClient();
  const { data: current } = await supabase.from("team_roster").select("name").eq("id", id).single();
  if (!current) return { error: "That person is no longer on the list." };

  if (current.name !== v.name) {
    if (await nameTaken(supabase, v.name, id)) return { error: `${v.name} is already on the list.` };

    // Jobs and leads keep the name they were saved with, and an agent's login
    // reaches their own jobs through that same name. So a name with a login
    // behind it must be changed from Users, where that link is understood.
    const { data: logins } = await supabase.from("profiles").select("agent_name").not("agent_name", "is", null);
    if ((logins ?? []).some((p) => (p.agent_name ?? "").trim().toLowerCase() === current.name.toLowerCase())) {
      return {
        error: `${current.name} has a login (see Users). That login's name is how they reach their own jobs, so it can't be renamed here.`,
      };
    }
  }

  const { error } = await supabase
    .from("team_roster")
    .update({ name: v.name, is_agent: input.isAgent, is_dispatcher: input.isDispatcher, notes: v.notes })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: true };
}

// Deactivating takes someone out of the dropdowns for NEW assignments. Their
// past jobs, leads and reports are untouched. Reactivating puts them back.
export async function setTeamMemberActive(id: string, active: boolean): Promise<Result> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_roster")
    .update({ is_active: active, deactivated_at: active ? null : new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: true };
}

// Removing is only for entries that were never used (a typo, a duplicate). A
// name that appears on any job, lead or login can only be deactivated, so
// history is never orphaned.
export async function removeTeamMember(id: string): Promise<Result> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };

  const supabase = await createClient();
  const { data: person } = await supabase.from("team_roster").select("name").eq("id", id).single();
  if (!person) return { error: "That person is no longer on the list." };

  const count = async (table: string, column: string) => {
    const { count: n } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, person.name);
    return n ?? 0;
  };
  const used =
    (await count("jobs", "agent")) +
    (await count("jobs", "dispatcher")) +
    (await count("jobs", "quoted_by_dispatcher")) +
    (await count("leads", "agent")) +
    (await count("leads", "dispatcher")) +
    (await count("profiles", "agent_name"));
  if (used > 0) {
    return {
      error: `${person.name} appears on ${used} existing record${used === 1 ? "" : "s"} (jobs, leads or a login), so they can't be removed. Deactivate them instead — all history stays exactly as it is.`,
    };
  }

  const { error } = await supabase.from("team_roster").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: true };
}

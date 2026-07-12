import { createClient } from "@/lib/supabase/server";

export interface Profile {
  role: "agent" | "manager";
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

export async function requireManager(): Promise<
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

  if (data?.role !== "manager") {
    return { ok: false, error: "Only managers can do this." };
  }

  return { ok: true, userId: user.id };
}

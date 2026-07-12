"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type ActionResult = { success: true } | { error: string };

export async function clockIn(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: openEntry } = await supabase
    .from("time_entries")
    .select("id")
    .eq("user_id", user.id)
    .is("clock_out", null)
    .maybeSingle();

  if (openEntry) return { error: "Already clocked in." };

  const { error } = await supabase.from("time_entries").insert({ user_id: user.id });
  if (error) return { error: error.message };

  revalidatePath("/hours");
  return { success: true };
}

export async function clockOut(entryId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("time_entries")
    .update({ clock_out: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/hours");
  return { success: true };
}

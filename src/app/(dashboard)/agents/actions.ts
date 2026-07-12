"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/profile";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { success: true; password: string } | { error: string };

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

export async function createAgent(email: string, agentName: string): Promise<ActionResult> {
  const check = await requireManager();
  if (!check.ok) return { error: check.error };

  const trimmedEmail = email.trim();
  if (!trimmedEmail) return { error: "Enter an email address." };
  if (!agentName.trim()) return { error: "Select an agent name." };

  const password = generatePassword();
  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: trimmedEmail,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return { error: createError?.message ?? "Failed to create the account." };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    role: "agent",
    agent_name: agentName.trim(),
    email: trimmedEmail,
  });

  if (profileError) {
    return { error: profileError.message };
  }

  revalidatePath("/agents");
  return { success: true, password };
}

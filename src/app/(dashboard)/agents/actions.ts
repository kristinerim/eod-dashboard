"use server";

import { revalidatePath } from "next/cache";
import { requireFullAdmin, ALL_ROLES, type Role } from "@/lib/profile";
import { createAdminClient } from "@/lib/supabase/admin";

type ActionResult = { success: true } | { error: string };
type CreateResult = { success: true; password: string } | { error: string };

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return password;
}

function isRole(value: string): value is Role {
  return (ALL_ROLES as string[]).includes(value);
}

async function countOtherFullAdmins(excludeUserId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .in("role", ["operations_manager", "admin_coordinator"])
    .neq("id", excludeUserId);
  return count ?? 0;
}

export async function createUser(email: string, name: string, role: string): Promise<CreateResult> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };

  const trimmedEmail = email.trim();
  if (!trimmedEmail) return { error: "Enter an email address." };
  if (!isRole(role)) return { error: "Select a valid role." };
  if (role === "agent" && !name.trim()) return { error: "Enter the agent's name." };

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
    role,
    agent_name: name.trim() || null,
    email: trimmedEmail,
  });

  if (profileError) {
    return { error: profileError.message };
  }

  revalidatePath("/agents");
  return { success: true, password };
}

export async function updateUserRole(userId: string, newRole: string): Promise<ActionResult> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };
  if (!isRole(newRole)) return { error: "Select a valid role." };
  if (userId === check.userId) return { error: "You can't change your own role." };

  const admin = createAdminClient();

  if (newRole !== "operations_manager" && newRole !== "admin_coordinator") {
    const { data: target } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (target && (target.role === "operations_manager" || target.role === "admin_coordinator")) {
      const remaining = await countOtherFullAdmins(userId);
      if (remaining === 0) {
        return { error: "This is the last admin account — promote another user before changing this one." };
      }
    }
  }

  const { error } = await admin.from("profiles").update({ role: newRole }).eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/agents");
  return { success: true };
}

export async function deactivateUser(userId: string): Promise<ActionResult> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };
  if (userId === check.userId) return { error: "You can't deactivate your own account." };

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("role").eq("id", userId).single();
  if (target && (target.role === "operations_manager" || target.role === "admin_coordinator")) {
    const remaining = await countOtherFullAdmins(userId);
    if (remaining === 0) {
      return { error: "This is the last admin account — promote another user before deactivating this one." };
    }
  }

  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (error) return { error: error.message };

  revalidatePath("/agents");
  return { success: true };
}

export async function reactivateUser(userId: string): Promise<ActionResult> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (error) return { error: error.message };

  revalidatePath("/agents");
  return { success: true };
}

export async function deleteUserAccount(userId: string): Promise<ActionResult> {
  const check = await requireFullAdmin();
  if (!check.ok) return { error: check.error };
  if (userId === check.userId) return { error: "You can't delete your own account." };

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("role").eq("id", userId).single();
  if (target && (target.role === "operations_manager" || target.role === "admin_coordinator")) {
    const remaining = await countOtherFullAdmins(userId);
    if (remaining === 0) {
      return { error: "This is the last admin account — promote another user before deleting this one." };
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };

  revalidatePath("/agents");
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/aggregate";
import { getCurrentProfile, isSupervisor, requireSupervisor } from "@/lib/profile";

function numberOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function strOrNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function isDispatchedStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "dispatched";
}

function isPendingCompletionStatus(status: string | null): boolean {
  return status?.trim().toLowerCase() === "service rendered – pending completion";
}

type ActionResult = { success: true; id?: string } | { error: string };

export async function getOrCreateTodaysReport(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("reports")
    .upsert({ report_date: todayISO(), uploaded_by: user.id }, { onConflict: "report_date" })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Failed to create today's report." };
  revalidatePath("/");
  return { success: true, id: data.id };
}

function jobFieldsFromForm(formData: FormData) {
  const job_amount = numberOrNull(formData.get("job_amount"));
  const vendors_fee = numberOrNull(formData.get("vendors_fee"));
  const refunded_to_client = numberOrNull(formData.get("refunded_to_client"));
  const profit = (job_amount ?? 0) - (vendors_fee ?? 0) - (refunded_to_client ?? 0);

  return {
    agent: strOrNull(formData.get("agent")),
    dispatcher: strOrNull(formData.get("dispatcher")),
    job_number: strOrNull(formData.get("job_number")),
    job_amount,
    vendors_fee,
    refunded_to_client,
    profit,
    vendor_name: strOrNull(formData.get("vendor_name")),
    job_status: strOrNull(formData.get("job_status")),
    eta_minutes: numberOrNull(formData.get("eta_minutes")),
    state: strOrNull(formData.get("state")),
    customer_phone: strOrNull(formData.get("customer_phone")),
    customer_charged_via: strOrNull(formData.get("customer_charged_via")),
    vendor_paid_via: strOrNull(formData.get("vendor_paid_via")),
    notes: strOrNull(formData.get("notes")),
    last4_vpc: strOrNull(formData.get("last4_vpc")),
    reviewed_by: strOrNull(formData.get("reviewed_by")),
    call_que: strOrNull(formData.get("call_que")),
    wc_entered_by_jon: strOrNull(formData.get("wc_entered_by_jon")),
    final_checked_by_zumi: strOrNull(formData.get("final_checked_by_zumi")),
  };
}

export async function createJob(reportId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const fields = jobFieldsFromForm(formData);

  const profile = await getCurrentProfile();
  if (!isSupervisor(profile?.role)) {
    if (!profile?.agent_name) {
      return { error: "Your account isn't linked to an agent name — ask an admin to fix your profile." };
    }
    if (fields.agent !== profile.agent_name) {
      return { error: "You can only create jobs under your own name." };
    }
  }

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", reportId);

  const { error } = await supabase.from("jobs").insert({
    ...fields,
    report_id: reportId,
    row_number: (count ?? 0) + 1,
    source: "manual",
    created_by: user.id,
    dispatched_at: isDispatchedStatus(fields.job_status) ? new Date().toISOString() : null,
    pending_completion_at: isPendingCompletionStatus(fields.job_status)
      ? new Date().toISOString()
      : null,
  });

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

type JobContext =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      reportId: string;
      currentAgent: string | null;
      currentStatus: string | null;
      currentDispatchedAt: string | null;
      currentPendingCompletionAt: string | null;
    }
  | { ok: false; error: string };

async function requireJobContext(jobId: string): Promise<JobContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: existing, error } = await supabase
    .from("jobs")
    .select("report_id, agent, job_status, dispatched_at, pending_completion_at")
    .eq("id", jobId)
    .single();

  if (error || !existing) return { ok: false, error: "Job not found." };

  return {
    ok: true,
    supabase,
    reportId: existing.report_id as string,
    currentAgent: existing.agent,
    currentStatus: existing.job_status,
    currentDispatchedAt: existing.dispatched_at,
    currentPendingCompletionAt: existing.pending_completion_at,
  };
}

export async function updateJob(jobId: string, formData: FormData): Promise<ActionResult> {
  const check = await requireJobContext(jobId);
  if (!check.ok) return { error: check.error };
  const {
    supabase,
    reportId,
    currentAgent,
    currentStatus,
    currentDispatchedAt,
    currentPendingCompletionAt,
  } = check;

  const fields = jobFieldsFromForm(formData);

  const profile = await getCurrentProfile();
  if (!isSupervisor(profile?.role)) {
    if (!profile?.agent_name) {
      return { error: "Your account isn't linked to an agent name — ask an admin to fix your profile." };
    }
    if (currentAgent !== profile.agent_name) {
      return { error: "You can only edit jobs assigned to you." };
    }
    if (fields.agent !== profile.agent_name) {
      return { error: "You can only assign jobs to yourself." };
    }
  }

  const dispatched_at = isDispatchedStatus(fields.job_status)
    ? isDispatchedStatus(currentStatus) && currentDispatchedAt
      ? currentDispatchedAt
      : new Date().toISOString()
    : null;

  const pending_completion_at = isPendingCompletionStatus(fields.job_status)
    ? isPendingCompletionStatus(currentStatus) && currentPendingCompletionAt
      ? currentPendingCompletionAt
      : new Date().toISOString()
    : null;

  const { error } = await supabase
    .from("jobs")
    .update({ ...fields, dispatched_at, pending_completion_at })
    .eq("id", jobId);

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

export async function deleteJob(jobId: string): Promise<ActionResult> {
  const supervisorCheck = await requireSupervisor();
  if (!supervisorCheck.ok) return { error: supervisorCheck.error };

  const check = await requireJobContext(jobId);
  if (!check.ok) return { error: check.error };
  const { supabase, reportId } = check;

  const { error } = await supabase.from("jobs").delete().eq("id", jobId);

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

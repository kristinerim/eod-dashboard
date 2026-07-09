"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/aggregate";

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
  const profit = (job_amount ?? 0) - (vendors_fee ?? 0);

  return {
    agent: strOrNull(formData.get("agent")),
    dispatcher: strOrNull(formData.get("dispatcher")),
    job_number: strOrNull(formData.get("job_number")),
    job_amount,
    vendors_fee,
    profit,
    vendor_name: strOrNull(formData.get("vendor_name")),
    job_status: strOrNull(formData.get("job_status")),
    eta_minutes: numberOrNull(formData.get("eta_minutes")),
    state: strOrNull(formData.get("state")),
    customer_phone: strOrNull(formData.get("customer_phone")),
    customer_charged_via: strOrNull(formData.get("customer_charged_via")),
    vendor_paid_via: strOrNull(formData.get("vendor_paid_via")),
    notes: strOrNull(formData.get("notes")),
  };
}

export async function createJob(reportId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", reportId);

  const fields = jobFieldsFromForm(formData);

  const { error } = await supabase.from("jobs").insert({
    ...fields,
    report_id: reportId,
    row_number: (count ?? 0) + 1,
    source: "manual",
    created_by: user.id,
    dispatched_at: isDispatchedStatus(fields.job_status) ? new Date().toISOString() : null,
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
      currentStatus: string | null;
      currentDispatchedAt: string | null;
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
    .select("report_id, job_status, dispatched_at")
    .eq("id", jobId)
    .single();

  if (error || !existing) return { ok: false, error: "Job not found." };

  return {
    ok: true,
    supabase,
    reportId: existing.report_id as string,
    currentStatus: existing.job_status,
    currentDispatchedAt: existing.dispatched_at,
  };
}

export async function updateJob(jobId: string, formData: FormData): Promise<ActionResult> {
  const check = await requireJobContext(jobId);
  if (!check.ok) return { error: check.error };
  const { supabase, reportId, currentStatus, currentDispatchedAt } = check;

  const fields = jobFieldsFromForm(formData);
  const dispatched_at = isDispatchedStatus(fields.job_status)
    ? isDispatchedStatus(currentStatus) && currentDispatchedAt
      ? currentDispatchedAt
      : new Date().toISOString()
    : null;

  const { error } = await supabase
    .from("jobs")
    .update({ ...fields, dispatched_at })
    .eq("id", jobId);

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

export async function deleteJob(jobId: string): Promise<ActionResult> {
  const check = await requireJobContext(jobId);
  if (!check.ok) return { error: check.error };
  const { supabase, reportId } = check;

  const { error } = await supabase.from("jobs").delete().eq("id", jobId);

  if (error) return { error: error.message };
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true };
}

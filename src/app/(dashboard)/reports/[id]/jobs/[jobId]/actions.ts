"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSupervisor } from "@/lib/profile";

type ActionResult = { success: true } | { error: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

function revalidateJob(reportId: string, jobId: string) {
  revalidatePath(`/reports/${reportId}`);
  revalidatePath(`/reports/${reportId}/jobs/${jobId}`);
  revalidatePath("/");
  revalidatePath("/dispatched");
  revalidatePath("/completed-jobs");
  revalidatePath("/cancelled-jobs");
}

export async function cancelJob(
  jobId: string,
  reportId: string,
  reason: string
): Promise<ActionResult> {
  const user = await requireUser();
  if (!user) return { error: "Not signed in." };
  if (!reason.trim()) return { error: "Enter a reason for the cancellation." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("jobs")
    .select("job_status, cancelled_at")
    .eq("id", jobId)
    .single();

  const alreadyCancelled = existing?.job_status?.trim().toLowerCase() === "cancelled";
  const cancelled_at = alreadyCancelled && existing?.cancelled_at
    ? existing.cancelled_at
    : new Date().toISOString();

  const { error } = await admin
    .from("jobs")
    // Cancelled jobs never have a real profit to report.
    .update({ job_status: "Cancelled", cancellation_reason: reason.trim(), cancelled_at, profit: null })
    .eq("id", jobId);
  if (error) return { error: error.message };

  revalidateJob(reportId, jobId);
  return { success: true };
}

export async function refundJob(
  jobId: string,
  reportId: string,
  amount: number
): Promise<ActionResult> {
  const user = await requireUser();
  if (!user) return { error: "Not signed in." };
  if (Number.isNaN(amount) || amount < 0) return { error: "Enter a valid refund amount." };

  const admin = createAdminClient();
  const { data: job, error: fetchError } = await admin
    .from("jobs")
    .select("job_amount, vendors_fee, job_status")
    .eq("id", jobId)
    .single();
  if (fetchError || !job) return { error: fetchError?.message ?? "Job not found." };

  // Same rule as job-actions.ts: no profit until a vendor fee is entered, and
  // never for appointments or cancelled jobs.
  const status = job.job_status?.trim().toLowerCase();
  const profit =
    job.vendors_fee === null || status === "appointment" || status === "cancelled"
      ? null
      : (job.job_amount ?? 0) - job.vendors_fee - amount;

  const { error } = await admin
    .from("jobs")
    .update({ refunded_to_client: amount, profit })
    .eq("id", jobId);
  if (error) return { error: error.message };

  revalidateJob(reportId, jobId);
  return { success: true };
}

export async function deleteJobAnyDay(jobId: string, reportId: string): Promise<ActionResult> {
  const check = await requireSupervisor();
  if (!check.ok) return { error: check.error };

  const admin = createAdminClient();
  const { error } = await admin.from("jobs").delete().eq("id", jobId);
  if (error) return { error: error.message };

  revalidateJob(reportId, jobId);
  return { success: true };
}

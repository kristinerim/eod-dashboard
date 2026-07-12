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
  const { error } = await admin
    .from("jobs")
    .update({ job_status: "Cancelled", cancellation_reason: reason.trim() })
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
    .select("job_amount, vendors_fee")
    .eq("id", jobId)
    .single();
  if (fetchError || !job) return { error: fetchError?.message ?? "Job not found." };

  const profit = (job.job_amount ?? 0) - (job.vendors_fee ?? 0) - amount;

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

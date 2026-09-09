"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { dateInPHT, todayISO } from "@/lib/aggregate";
import { getCurrentProfile, isSupervisor, requireSupervisor } from "@/lib/profile";
import {
  jobFieldsFromForm,
  upsertReportForDate,
  validateCoreRequiredFields,
  validateEtaUpdatedOnDispatch,
  validateNewJobRequiredFields,
  validatePendingCompletionSubstatus,
  validateTimeDispatchedRequired,
  validateUniqueJobNumber,
  isCancelledJobStatus,
  isCompletedJobStatus,
  isPendingCompletionStatus,
} from "./job-fields";

type ActionResult = { success: true; id?: string } | { error: string };

export async function getOrCreateTodaysReport(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const resolved = await upsertReportForDate(supabase, user.id, todayISO());
  if ("error" in resolved) return resolved;

  revalidatePath("/");
  return { success: true, id: resolved.id };
}

export async function createJob(reportId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const fields = jobFieldsFromForm(formData);

  const coreError = validateCoreRequiredFields(fields);
  if (coreError) return { error: coreError };

  const newJobError = validateNewJobRequiredFields(fields);
  if (newJobError) return { error: newJobError };

  const duplicateJobNumberError = await validateUniqueJobNumber(supabase, fields.job_number);
  if (duplicateJobNumberError) return { error: duplicateJobNumberError };

  const timeDispatchedError = validateTimeDispatchedRequired(
    fields.job_status,
    fields.time_dispatched
  );
  if (timeDispatchedError) return { error: timeDispatchedError };

  const substatusError = validatePendingCompletionSubstatus(
    fields.job_status,
    fields.pending_completion_substatus
  );
  if (substatusError) return { error: substatusError };

  const profile = await getCurrentProfile();
  if (!isSupervisor(profile?.role)) {
    if (!profile?.agent_name) {
      return { error: "Your account isn't linked to an agent name — ask an admin to fix your profile." };
    }
    if (fields.agent !== profile.agent_name) {
      return { error: "You can only create jobs under your own name." };
    }
  }

  // A job counts toward the day it was dispatched, not the day it was added —
  // if a dispatch time is already known, file it under that date's report.
  let targetReportId = reportId;
  if (fields.time_dispatched) {
    const resolved = await upsertReportForDate(supabase, user.id, dateInPHT(fields.time_dispatched));
    if ("error" in resolved) return { error: resolved.error };
    targetReportId = resolved.id;
  }

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", targetReportId);

  const { data: inserted, error } = await supabase
    .from("jobs")
    .insert({
      ...fields,
      report_id: targetReportId,
      row_number: (count ?? 0) + 1,
      source: "manual",
      created_by: user.id,
      pending_completion_at: isPendingCompletionStatus(fields.job_status)
        ? new Date().toISOString()
        : null,
      completed_at: isCompletedJobStatus(fields.job_status) ? new Date().toISOString() : null,
      cancelled_at: isCancelledJobStatus(fields.job_status) ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath(`/reports/${targetReportId}`);
  if (targetReportId !== reportId) revalidatePath(`/reports/${reportId}`);
  revalidatePath("/");
  return { success: true, id: inserted?.id };
}

type JobContext =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      reportId: string;
      currentAgent: string | null;
      currentStatus: string | null;
      currentEtaMinutes: number | null;
      currentPendingCompletionAt: string | null;
      currentCompletedAt: string | null;
      currentCancelledAt: string | null;
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
    .select("report_id, agent, job_status, eta_minutes, pending_completion_at, completed_at, cancelled_at")
    .eq("id", jobId)
    .single();

  if (error || !existing) return { ok: false, error: "Job not found." };

  return {
    ok: true,
    supabase,
    reportId: existing.report_id as string,
    currentAgent: existing.agent,
    currentStatus: existing.job_status,
    currentEtaMinutes: existing.eta_minutes,
    currentPendingCompletionAt: existing.pending_completion_at,
    currentCompletedAt: existing.completed_at,
    currentCancelledAt: existing.cancelled_at,
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
    currentEtaMinutes,
    currentPendingCompletionAt,
    currentCompletedAt,
    currentCancelledAt,
  } = check;

  const fields = jobFieldsFromForm(formData);

  const coreError = validateCoreRequiredFields(fields);
  if (coreError) return { error: coreError };

  const duplicateJobNumberError = await validateUniqueJobNumber(supabase, fields.job_number, jobId);
  if (duplicateJobNumberError) return { error: duplicateJobNumberError };

  const timeDispatchedError = validateTimeDispatchedRequired(
    fields.job_status,
    fields.time_dispatched
  );
  if (timeDispatchedError) return { error: timeDispatchedError };

  const etaUpdatedError = validateEtaUpdatedOnDispatch(
    currentStatus,
    fields.job_status,
    currentEtaMinutes,
    fields.eta_minutes
  );
  if (etaUpdatedError) return { error: etaUpdatedError };

  const substatusError = validatePendingCompletionSubstatus(
    fields.job_status,
    fields.pending_completion_substatus
  );
  if (substatusError) return { error: substatusError };

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

  const pending_completion_at = isPendingCompletionStatus(fields.job_status)
    ? isPendingCompletionStatus(currentStatus) && currentPendingCompletionAt
      ? currentPendingCompletionAt
      : new Date().toISOString()
    : null;

  const completed_at = isCompletedJobStatus(fields.job_status)
    ? isCompletedJobStatus(currentStatus) && currentCompletedAt
      ? currentCompletedAt
      : new Date().toISOString()
    : null;

  const cancelled_at = isCancelledJobStatus(fields.job_status)
    ? isCancelledJobStatus(currentStatus) && currentCancelledAt
      ? currentCancelledAt
      : new Date().toISOString()
    : null;

  // A job counts toward the day it was dispatched, not the day it was
  // created or converted — whenever the dispatch time changes, move the job
  // to that date's report so it's reflected everywhere.
  let targetReportId = reportId;
  let row_number: number | undefined;
  if (fields.time_dispatched) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not signed in." };

    const resolved = await upsertReportForDate(supabase, user.id, dateInPHT(fields.time_dispatched));
    if ("error" in resolved) return { error: resolved.error };
    targetReportId = resolved.id;

    if (targetReportId !== reportId) {
      const { count } = await supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("report_id", targetReportId);
      row_number = (count ?? 0) + 1;
    }
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      ...fields,
      pending_completion_at,
      completed_at,
      cancelled_at,
      ...(targetReportId !== reportId ? { report_id: targetReportId, row_number } : {}),
    })
    .eq("id", jobId);

  if (error) return { error: error.message };
  revalidatePath(`/reports/${targetReportId}`);
  if (targetReportId !== reportId) revalidatePath(`/reports/${reportId}`);
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

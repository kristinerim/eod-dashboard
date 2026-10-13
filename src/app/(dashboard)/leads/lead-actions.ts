"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { todayISO } from "@/lib/aggregate";
import { getCurrentProfile, isSupervisor, requireSupervisor } from "@/lib/profile";
import { LEAD_DISPOSITIONS, QUOTE_STATUSES, type QuoteStatus } from "@/lib/constants";
import { intakeFieldsFromForm, intakeInitialFromRecord } from "@/lib/intake";
import { normalizeEmail, normalizeName, normalizePhone } from "@/lib/leadMatching";
import { numberOrNull } from "@/lib/formParse";
import { CONTACT_REQUIRED_MESSAGE, hasValidContact } from "@/lib/contact";
import { jobFieldsFromForm, strOrNull, upsertReportForDate } from "../reports/[id]/job-fields";

type ActionResult = { success: true } | { error: string };

function leadFieldsFromForm(formData: FormData) {
  const { client_email, ...intake } = intakeFieldsFromForm(formData);
  const customerPhone = intake.customer_phone;

  return {
    ...intake,
    agent: strOrNull(formData.get("agent")),
    dispatcher: strOrNull(formData.get("dispatcher")),
    source: strOrNull(formData.get("source")),
    notes: strOrNull(formData.get("notes")),
    // Leads call it `email`; jobs call it `client_email`.
    email: client_email,
    quoted_price: numberOrNull(formData.get("quoted_price")),
    // Kept in sync so customer matching (phone → email → name) finds leads
    // created by hand, not just the ones auto-created from jobs.
    phone_normalized: normalizePhone(customerPhone),
    email_normalized: normalizeEmail(client_email),
    name_normalized: normalizeName(intake.customer_name),
  };
}

// A lead can be saved mid-call with almost nothing filled in — it just can't
// be completely empty.
function leadHasAnyContent(fields: ReturnType<typeof leadFieldsFromForm>): boolean {
  return [
    fields.job_type,
    fields.customer_name,
    fields.customer_phone,
    fields.service_street_address,
    fields.service_city,
    fields.vehicle_year,
    fields.vehicle_make,
    fields.vehicle_model,
    fields.issue,
    fields.quoted_price,
  ].some((v) => v !== null && v !== undefined);
}

async function requireLeadPermission(agent: string | null): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (isSupervisor(profile?.role)) return null;
  if (!profile?.agent_name) {
    return "Your account isn't linked to an agent name — ask an admin to fix your profile.";
  }
  if (agent !== profile.agent_name) {
    return "You can only manage leads assigned to your own name.";
  }
  return null;
}

function revalidateLeads(leadId?: string) {
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

async function requireLead(supabase: Awaited<ReturnType<typeof createClient>>, leadId: string) {
  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", leadId).single();
  if (error || !lead) return { ok: false as const, error: "Lead not found." };
  return { ok: true as const, lead };
}

export type SaveLeadIntent = "save" | "quote" | "accepted" | "declined" | "follow_up";

type SaveLeadResult = { success: true; id: string; leadNumber: string } | { error: string };

// Create-or-update for the guided workflow. `intent` records what the agent
// just did on the Pricing step; "declined" also closes the lead out as lost.
export async function saveLead(
  leadId: string | null,
  formData: FormData,
  intent: SaveLeadIntent
): Promise<SaveLeadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const fields = leadFieldsFromForm(formData);
  if (!leadHasAnyContent(fields)) {
    return { error: "Enter at least a service type, customer, vehicle, or location before saving." };
  }
  // Every save needs a way to reach the customer: a valid phone OR email.
  if (!hasValidContact(fields.customer_phone, fields.email)) {
    return { error: CONTACT_REQUIRED_MESSAGE };
  }

  let existing: { agent: string | null; status: string; quote_status: string | null } | null = null;
  if (leadId) {
    const check = await requireLead(supabase, leadId);
    if (!check.ok) return { error: check.error };
    if (check.lead.status !== "open") return { error: "Only an open lead can be edited." };
    existing = check.lead;
    const ownerError = await requireLeadPermission(check.lead.agent);
    if (ownerError) return { error: ownerError };
  }
  const permissionError = await requireLeadPermission(fields.agent);
  if (permissionError) return { error: permissionError };

  const posted = strOrNull(formData.get("quote_status"));
  const previous: QuoteStatus =
    posted && (QUOTE_STATUSES as readonly string[]).includes(posted)
      ? (posted as QuoteStatus)
      : ((existing?.quote_status as QuoteStatus | null) ?? "quoting");
  const quote_status: QuoteStatus =
    intent === "quote"
      ? "quoted"
      : intent === "accepted"
        ? "accepted"
        : intent === "declined"
          ? "declined"
          : intent === "follow_up"
            ? "follow_up"
            : previous;

  const row = {
    ...fields,
    quote_status,
    ...(intent === "declined"
      ? { status: "lost", disposition: "Customer Declined", disposition_at: new Date().toISOString() }
      : {}),
  };

  const query = leadId
    ? supabase.from("leads").update(row).eq("id", leadId)
    : supabase.from("leads").insert({ ...row, created_by: user.id });
  const { data, error } = await query.select("id, lead_number").single();

  if (error || !data) return { error: error?.message ?? "Failed to save the lead." };
  revalidateLeads(data.id);
  return { success: true, id: data.id, leadNumber: data.lead_number };
}

export async function markLeadLost(leadId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const check = await requireLead(supabase, leadId);
  if (!check.ok) return { error: check.error };
  if (check.lead.status !== "open") return { error: "Only an open lead can be marked lost." };

  const permissionError = await requireLeadPermission(check.lead.agent);
  if (permissionError) return { error: permissionError };

  const disposition = strOrNull(formData.get("disposition"));
  if (!disposition || !LEAD_DISPOSITIONS.includes(disposition)) {
    return { error: "Select a reason the lead didn't convert." };
  }
  const disposition_notes = strOrNull(formData.get("disposition_notes"));

  const { error } = await supabase
    .from("leads")
    .update({
      status: "lost",
      disposition,
      disposition_notes,
      disposition_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) return { error: error.message };
  revalidateLeads(leadId);
  return { success: true };
}

export async function reopenLead(leadId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const check = await requireLead(supabase, leadId);
  if (!check.ok) return { error: check.error };
  if (check.lead.status !== "lost") return { error: "Only a lost lead can be reopened." };

  const permissionError = await requireLeadPermission(check.lead.agent);
  if (permissionError) return { error: permissionError };

  const { error } = await supabase
    .from("leads")
    .update({ status: "open", disposition: null, disposition_notes: null, disposition_at: null })
    .eq("id", leadId);

  if (error) return { error: error.message };
  revalidateLeads(leadId);
  return { success: true };
}

export async function deleteLead(leadId: string): Promise<ActionResult> {
  const supervisorCheck = await requireSupervisor();
  if (!supervisorCheck.ok) return { error: supervisorCheck.error };

  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) return { error: error.message };

  revalidateLeads();
  return { success: true };
}

export type CreateJobFromLeadResult =
  | { success: true; job: Record<string, unknown>; reportId: string; leadNumber: string }
  // The lead already has a job (a second click, or another window): open that one.
  | { existing: { reportId: string; jobId: string } }
  | { error: string };

// "Customer Proceed" -> "Yes - Create Job". The form has already saved the
// lead. This creates the Job right now, carrying everything the lead holds
// (customer, locations, vehicle and service details, distance, quote, notes,
// agent), links the two records, and marks the lead Converted. The job number
// isn't known yet, so it starts blank and is required when the job is saved
// from Dispatch & Operations.
//
// The lead is claimed first in one conditional update, so a double click (or
// two windows) can only ever produce one job.
export async function createJobFromLead(leadId: string): Promise<CreateJobFromLeadResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const check = await requireLead(supabase, leadId);
  if (!check.ok) return { error: check.error };
  const lead = check.lead;

  if (lead.status === "converted" && lead.job_id) {
    const { data: job } = await supabase.from("jobs").select("report_id").eq("id", lead.job_id).single();
    if (job) return { existing: { reportId: job.report_id, jobId: lead.job_id } };
  }
  if (lead.status !== "open") return { error: "This lead is closed. Reopen it before creating a job from it." };

  const permissionError = await requireLeadPermission(lead.agent);
  if (permissionError) return { error: permissionError };
  if (!lead.agent) return { error: "Select the agent for this lead before creating a job." };

  // The job takes everything the lead collected, through the same parsing a
  // saved job form uses (so composed values like the vehicle and drop-off
  // lines come out identically).
  const initial = intakeInitialFromRecord(lead);
  const formData = new FormData();
  for (const [key, value] of Object.entries(initial)) if (value !== "") formData.set(key, value);
  const quoteTotal = (Number(lead.quoted_price) || 0) + (Number(lead.additional_charges) || 0);
  if (quoteTotal > 0) formData.set("job_amount", String(quoteTotal));
  formData.set("job_status", "Converted");
  // Philippine Time wall clock, the way the job form reads it.
  formData.set("time_converted", new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const fields = jobFieldsFromForm(formData);

  const { data: claimed, error: claimError } = await supabase
    .from("leads")
    .update({ status: "converted", converted_at: new Date().toISOString(), quote_status: "accepted" })
    .eq("id", leadId)
    .eq("status", "open")
    .select("id");
  if (claimError) return { error: claimError.message };
  if (!claimed || claimed.length === 0) return { error: "This lead was already converted or closed." };

  const giveLeadBack = () => supabase.from("leads").update({ status: "open", converted_at: null }).eq("id", leadId);

  const resolved = await upsertReportForDate(supabase, user.id, todayISO());
  if ("error" in resolved) {
    await giveLeadBack();
    return { error: resolved.error };
  }

  const { count } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", resolved.id);

  const { data: inserted, error: insertError } = await supabase
    .from("jobs")
    .insert({
      ...fields,
      report_id: resolved.id,
      row_number: (count ?? 0) + 1,
      source: "manual",
      created_by: user.id,
      lead_id: leadId,
    })
    .select("*")
    .single();
  if (insertError || !inserted) {
    await giveLeadBack();
    return { error: insertError?.message ?? "Failed to create the job." };
  }

  const { error: linkError } = await supabase.from("leads").update({ job_id: inserted.id }).eq("id", leadId);
  if (linkError) console.error(`Failed to link lead ${leadId} to job ${inserted.id}:`, linkError.message);

  revalidateLeads(leadId);
  revalidatePath(`/reports/${resolved.id}`);
  revalidatePath("/");

  return { success: true, job: inserted, reportId: resolved.id, leadNumber: lead.lead_number };
}

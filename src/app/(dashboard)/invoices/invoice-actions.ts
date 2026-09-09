"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isSupervisor, requireSupervisor } from "@/lib/profile";
import { INVOICE_STATUSES } from "@/lib/constants";

type ActionResult = { success: true; id?: string } | { error: string };

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

function revalidateInvoice(reportId: string | undefined, jobId: string, invoiceId?: string) {
  revalidatePath("/invoices");
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`);
  if (reportId) {
    revalidatePath(`/reports/${reportId}`);
    revalidatePath(`/reports/${reportId}/jobs/${jobId}`);
  }
}

async function requireInvoicePermission(jobId: string): Promise<string | null> {
  const supabase = await createClient();
  const profile = await getCurrentProfile();
  if (isSupervisor(profile?.role)) return null;

  const { data: job } = await supabase.from("jobs").select("agent").eq("id", jobId).single();
  if (!profile?.agent_name || job?.agent !== profile.agent_name) {
    return "You can only manage invoices for your own jobs.";
  }
  return null;
}

// Pulls customer/job info straight from the Job so it never has to be typed
// in twice; the amount and service details default from the job but stay
// editable in the form before the invoice is created.
export async function createInvoice(jobId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, report_id, job_number, customer_name, customer_phone, state, job_amount, notes")
    .eq("id", jobId)
    .single();
  if (jobError || !job) return { error: "Job not found." };

  const permissionError = await requireInvoicePermission(jobId);
  if (permissionError) return { error: permissionError };

  const amount = numberOrNull(formData.get("amount")) ?? job.job_amount;
  if (amount === null) return { error: "Enter the invoice amount." };

  const { data: inserted, error } = await supabase
    .from("invoices")
    .insert({
      job_id: jobId,
      customer_name: strOrNull(formData.get("customer_name")) ?? job.customer_name,
      customer_phone: strOrNull(formData.get("customer_phone")) ?? job.customer_phone,
      job_number: job.job_number,
      state: strOrNull(formData.get("state")) ?? job.state,
      service_details: strOrNull(formData.get("service_details")) ?? job.notes,
      amount,
      notes: strOrNull(formData.get("notes")),
      status: "Draft",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidateInvoice(job.report_id as string, jobId, inserted?.id);
  return { success: true, id: inserted?.id };
}

async function requireInvoiceContext(invoiceId: string) {
  const supabase = await createClient();
  const { data: invoice, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (error || !invoice) return { ok: false as const, error: "Invoice not found." };

  const { data: job } = await supabase.from("jobs").select("report_id").eq("id", invoice.job_id).single();

  return { ok: true as const, supabase, invoice, reportId: job?.report_id as string | undefined };
}

// Only Draft invoices can have their figures edited — once sent/paid/etc.
// the numbers need to stay as issued, matching how the rest of the app
// guards financial fields once they're "real" (see cancelJob/refundJob).
export async function updateInvoice(invoiceId: string, formData: FormData): Promise<ActionResult> {
  const check = await requireInvoiceContext(invoiceId);
  if (!check.ok) return { error: check.error };
  const { supabase, invoice, reportId } = check;

  if (invoice.status !== "Draft") return { error: "Only a Draft invoice can be edited." };

  const permissionError = await requireInvoicePermission(invoice.job_id);
  if (permissionError) return { error: permissionError };

  const amount = numberOrNull(formData.get("amount"));
  if (amount === null) return { error: "Enter the invoice amount." };

  const { error } = await supabase
    .from("invoices")
    .update({
      customer_name: strOrNull(formData.get("customer_name")),
      customer_phone: strOrNull(formData.get("customer_phone")),
      state: strOrNull(formData.get("state")),
      service_details: strOrNull(formData.get("service_details")),
      amount,
      notes: strOrNull(formData.get("notes")),
    })
    .eq("id", invoiceId);

  if (error) return { error: error.message };
  revalidateInvoice(reportId, invoice.job_id, invoiceId);
  return { success: true };
}

export async function setInvoiceStatus(invoiceId: string, status: string): Promise<ActionResult> {
  if (!INVOICE_STATUSES.includes(status)) return { error: "Invalid invoice status." };

  const check = await requireInvoiceContext(invoiceId);
  if (!check.ok) return { error: check.error };
  const { supabase, invoice, reportId } = check;

  const permissionError = await requireInvoicePermission(invoice.job_id);
  if (permissionError) return { error: permissionError };

  const now = new Date().toISOString();
  const timestampField =
    status === "Sent"
      ? "sent_at"
      : status === "Paid"
        ? "paid_at"
        : status === "Voided"
          ? "voided_at"
          : status === "Refunded"
            ? "refunded_at"
            : null;

  const update: Record<string, unknown> = { status };
  if (timestampField && !invoice[timestampField]) update[timestampField] = now;

  const { error } = await supabase.from("invoices").update(update).eq("id", invoiceId);
  if (error) return { error: error.message };

  revalidateInvoice(reportId, invoice.job_id, invoiceId);
  return { success: true };
}

// `amount` is a payment being processed now, not the new running total — it
// adds to whatever's already been paid, mirroring refundJob's accumulation
// so partial payments recorded separately add up correctly. Status flips to
// Paid once the full amount is covered, otherwise Partially Paid.
export async function recordInvoicePayment(invoiceId: string, amount: number): Promise<ActionResult> {
  if (Number.isNaN(amount) || amount <= 0) return { error: "Enter a valid payment amount." };

  const check = await requireInvoiceContext(invoiceId);
  if (!check.ok) return { error: check.error };
  const { supabase, invoice, reportId } = check;

  const permissionError = await requireInvoicePermission(invoice.job_id);
  if (permissionError) return { error: permissionError };

  const amount_paid = (invoice.amount_paid ?? 0) + amount;
  const isFullyPaid = invoice.amount !== null && amount_paid >= invoice.amount;
  const status = isFullyPaid ? "Paid" : "Partially Paid";
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("invoices")
    .update({
      amount_paid,
      status,
      paid_at: isFullyPaid && !invoice.paid_at ? now : invoice.paid_at,
    })
    .eq("id", invoiceId);

  if (error) return { error: error.message };
  revalidateInvoice(reportId, invoice.job_id, invoiceId);
  return { success: true };
}

export async function deleteInvoice(invoiceId: string): Promise<ActionResult> {
  const supervisorCheck = await requireSupervisor();
  if (!supervisorCheck.ok) return { error: supervisorCheck.error };

  const check = await requireInvoiceContext(invoiceId);
  if (!check.ok) return { error: check.error };
  const { supabase, invoice, reportId } = check;

  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (error) return { error: error.message };

  revalidateInvoice(reportId, invoice.job_id, invoiceId);
  return { success: true };
}

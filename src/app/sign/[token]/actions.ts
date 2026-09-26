"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildInvoiceViewModel } from "@/app/(dashboard)/invoices/invoice-document";
import type { InvoiceLineItemRow } from "@/app/(dashboard)/invoices/invoice-actions";

type ActionResult = { success: true } | { error: string };

// Runs with no signed-in user by design — the customer never logs in. The
// signature_token in the URL is the only credential; the admin client is
// used because RLS has no concept of an anonymous, token-scoped visitor.
export async function submitInvoiceSignature(token: string, formData: FormData): Promise<ActionResult> {
  const signatureImage = formData.get("signature_image");
  const signedName = formData.get("signed_name");

  if (typeof signatureImage !== "string" || !signatureImage.startsWith("data:image/")) {
    return { error: "Please draw your signature before submitting." };
  }
  if (typeof signedName !== "string" || !signedName.trim()) {
    return { error: "Enter your printed name." };
  }

  const supabase = createAdminClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("signature_token", token)
    .single();
  if (invoiceError || !invoice) return { error: "This signing link is invalid." };
  // Also enforced by a DB trigger — this is the fast, friendly path so a
  // double-click or a resubmitted form doesn't even attempt the write.
  if (invoice.signature_status === "Signed") return { error: "This invoice has already been signed." };

  const { data: job } = await supabase.from("jobs").select("*").eq("id", invoice.job_id).single();

  const { data: rawLineItems } = await supabase
    .from("invoice_line_items")
    .select("description, quantity, unit_price, amount")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true });

  const lineItems: InvoiceLineItemRow[] =
    rawLineItems && rawLineItems.length > 0
      ? rawLineItems
      : invoice.amount !== null
        ? [
            {
              description: invoice.service_details ?? job?.job_type ?? "Service",
              quantity: 1,
              unit_price: invoice.amount,
              amount: invoice.amount,
            },
          ]
        : [];

  // Freeze exactly what the customer is looking at right now — this is what
  // every future view of this invoice will show, regardless of later job edits.
  const snapshot = buildInvoiceViewModel({ invoice, job, lineItems });

  const { error } = await supabase
    .from("invoices")
    .update({
      signature_status: "Signed",
      signed_at: new Date().toISOString(),
      signed_name: signedName.trim(),
      signature_image: signatureImage,
      signed_snapshot: snapshot,
    })
    .eq("id", invoice.id);

  if (error) return { error: error.message };

  revalidatePath(`/invoices/${invoice.id}`);
  revalidatePath(`/sign/${token}`);
  if (job) revalidatePath(`/reports/${job.report_id}/jobs/${job.id}`);

  return { success: true };
}

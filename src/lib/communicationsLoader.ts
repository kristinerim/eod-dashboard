import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunicationRow } from "@/components/communications/types";

const COLUMNS =
  "id, channel, direction, party_type, party_name, from_address, to_address, subject, body, status, status_detail, sent_by_name, handled_by_name, created_at, job_id, lead_id, lead:leads(lead_number), job:jobs(job_number)";

export type CommunicationScope =
  | { kind: "job"; jobId: string; leadId: string | null }
  | { kind: "lead"; leadId: string }
  | { kind: "customer"; customerId: string }
  | { kind: "vendor"; vendorId: string };

// Each message is stored once and found through whichever link fits the screen:
//  - a job shows its own messages plus the messages from before it was a job
//    (the lead stage), but never messages from an unrelated job;
//  - a lead shows its lead-stage messages (once it is a job, new messages go there);
//  - a customer shows everything sent to or received from them;
//  - a vendor shows everything exchanged with that vendor.
// The database already limits all of this to what the viewer is allowed to see.
export async function loadCommunications(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  scope: CommunicationScope
): Promise<CommunicationRow[]> {
  let query = supabase.from("communications").select(COLUMNS);
  if (scope.kind === "job") {
    query = scope.leadId
      ? query.or(`job_id.eq.${scope.jobId},and(lead_id.eq.${scope.leadId},job_id.is.null)`)
      : query.eq("job_id", scope.jobId);
  } else if (scope.kind === "lead") {
    query = query.eq("lead_id", scope.leadId).is("job_id", null);
  } else if (scope.kind === "customer") {
    query = query.eq("customer_id", scope.customerId);
  } else {
    query = query.eq("vendor_id", scope.vendorId);
  }
  const { data } = await query.order("created_at", { ascending: true }).limit(500);
  return ((data ?? []) as unknown) as CommunicationRow[];
}

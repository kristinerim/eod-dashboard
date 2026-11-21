import type { CommunicationStatus } from "@/lib/communications";

export type MessageContext = {
  jobId?: string | null;
  leadId?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
};

export type CommunicationRow = {
  id: string;
  channel: "email" | "sms";
  direction: "outbound" | "inbound";
  party_type: "customer" | "vendor" | "other";
  party_name: string | null;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  body: string;
  status: CommunicationStatus;
  status_detail: string | null;
  sent_by_name: string | null;
  handled_by_name: string | null;
  created_at: string;
  job_id: string | null;
  lead_id: string | null;
  lead: { lead_number: string } | null;
  job: { job_number: string | null } | null;
};

export type TemplateRow = {
  id: string;
  audience: "customer" | "vendor";
  name: string;
  subject: string | null;
  body: string;
};

// Someone a message can be written to, with the contact details already saved.
export type Recipient = {
  id: string;
  label: string; // "Customer", "Vendor", ...
  partyType: "customer" | "vendor";
  name: string;
  email: string | null;
  phone: string | null;
  vendorId?: string | null;
  // Details a template can use when this recipient is chosen.
  quote?: string;
  eta?: string;
  isGo?: boolean;
};

export type InvoiceRef = { number: string | null; token: string };

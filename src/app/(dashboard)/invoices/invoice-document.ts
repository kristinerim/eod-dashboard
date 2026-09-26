import { JOB_TYPE_FIELD_KEYS, JOB_DETAIL_FIELD_DEFS, type JobDetailFieldKey } from "@/lib/jobTypeFields";

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface InvoiceInfoRow {
  label: string;
  value: string;
}

// Everything the customer actually saw and agreed to when they signed —
// this exact shape is what gets frozen into invoices.signed_snapshot, so a
// later edit to the job never silently changes the signed document. Amount
// paid / refund / balance due are NOT part of this (they're computed live
// wherever this is rendered), since payment tracking legitimately continues
// after signing.
export interface InvoiceViewModel {
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  billingAddress: string | null;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number | null;
  total: number;
  vehicleRows: InvoiceInfoRow[];
  serviceRows: InvoiceInfoRow[];
  authorization: {
    customerName: string;
    last4: string;
    serviceAmountFormatted: string;
    vehicleDescriptor: string;
  };
}

export function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatAddress(job: any): string | null {
  const line1 = [job?.service_street_address, job?.service_unit].filter(Boolean).join(", ");
  const cityStateZip = [job?.service_city, [job?.state, job?.service_zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const full = [line1, cityStateZip].filter(Boolean).join(", ");
  return full || null;
}

// Fields shown in Service Information beyond the always-present Service
// Requested / Amount / Problem / Service Location — only the ones that apply
// to this job's Job Type (per the dynamic Job Details config) and that
// actually have a value are rendered, per the "no blank fields" requirement.
const SERVICE_EXTRA_KEYS: JobDetailFieldKey[] = [
  "drop_off_location",
  "second_drop_off_location",
  "distance_miles",
  "number_of_gallons",
  "fuel_type",
  "tire_size",
  "trailer_type",
  "loaded_with",
  "trailer_weight",
  "trailer_length",
  "trailer_width",
  "trailer_height",
];

export function buildInvoiceViewModel({
  invoice,
  job,
  lineItems,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: any;
  lineItems: InvoiceLineItem[];
}): InvoiceViewModel {
  const subtotal = lineItems.reduce((sum, r) => sum + r.amount, 0);
  const tax = (invoice.tax_amount as number | null) ?? null;
  const total = subtotal + (tax ?? 0);

  // Customer/vehicle/service info reads live off the linked job rather than
  // the invoice's own copied snapshot columns, so an edit made on the job
  // shows up on the invoice automatically (until the invoice is signed, at
  // which point the caller freezes this whole object instead of rebuilding it).
  const customerName = job?.customer_name ?? invoice.customer_name ?? null;
  const customerPhone = job?.customer_phone ?? invoice.customer_phone ?? null;
  const customerEmail = job?.client_email ?? null;
  const billingAddress = job?.customer_billing_address ?? job?.billing_address ?? null;
  const serviceAddress = formatAddress(job);

  const typeFieldKeys: JobDetailFieldKey[] = (job?.job_type && JOB_TYPE_FIELD_KEYS[job.job_type]) || [];
  const hasKey = (k: JobDetailFieldKey) => typeFieldKeys.includes(k);
  const hasSecondDropOff = hasKey("second_drop_off_location") && !!job?.second_drop_off_location;

  const vehicleRows: InvoiceInfoRow[] = [
    job?.year_make_model ? { label: "Year / Make / Model", value: job.year_make_model as string } : null,
    job?.vin_or_lpn ? { label: "VIN or License Plate #", value: job.vin_or_lpn as string } : null,
    job?.color ? { label: "Color", value: job.color as string } : null,
  ].filter((r): r is InvoiceInfoRow => r !== null);

  const serviceRows: InvoiceInfoRow[] = [
    { label: "Service Requested", value: job?.job_type ?? job?.job_name ?? "-" },
    { label: "Service Amount", value: formatCurrency(total) },
    ...(job?.issue ? [{ label: "Problem / Issue", value: job.issue as string }] : []),
    ...(serviceAddress ? [{ label: "Service Location", value: serviceAddress }] : []),
    ...SERVICE_EXTRA_KEYS.flatMap((key) => {
      if (!hasKey(key)) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (job as any)?.[key];
      if (raw === null || raw === undefined || raw === "") return [];
      const value = key === "distance_miles" ? `${raw} mi` : String(raw);
      const label =
        key === "drop_off_location" && hasSecondDropOff ? "First Drop-Off Location" : JOB_DETAIL_FIELD_DEFS[key].label;
      return [{ label, value }];
    }),
  ];

  const vehicleDescriptor = job?.year_make_model || "vehicle";
  const last4 = job?.customer_card_last4 ? `••••${job.customer_card_last4}` : "____";

  return {
    customerName,
    customerPhone,
    customerEmail,
    billingAddress,
    lineItems,
    subtotal,
    tax,
    total,
    vehicleRows,
    serviceRows,
    authorization: {
      customerName: customerName ?? "the customer",
      last4,
      serviceAmountFormatted: formatCurrency(total),
      vehicleDescriptor,
    },
  };
}

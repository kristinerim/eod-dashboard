import { JOB_TYPE_FIELD_KEYS, type JobDetailFieldKey } from "./jobTypeFields";
import { numberOrNull, strOrNull } from "./formParse";
import { QUOTE_STATUS_LABELS, type QuoteStatus } from "./constants";

// The single description of the guided Create Lead / Create Job workflow:
// the order agents move through it (mirroring a live call), which fields
// belong to which step, and how the intake columns shared by `leads` and
// `jobs` are read back out of a submitted form. Pure — no server imports — so
// both server actions and client components can use it.

export type IntakeStepId =
  | "service"
  | "location"
  | "vehicle"
  | "details"
  | "customer"
  | "quote"
  | "convert";

export interface IntakeStepDef {
  id: IntakeStepId;
  title: string;
  prompt: string;
}

export const INTAKE_STEPS: IntakeStepDef[] = [
  { id: "service", title: "Service Type", prompt: "Thank you for calling Quick Towing. How can I help you today?" },
  {
    id: "location",
    title: "Service Location",
    prompt: "Can I get the address where your vehicle is currently located?",
  },
  { id: "vehicle", title: "Vehicle Information", prompt: "What's the year, make, and model of your vehicle?" },
  { id: "details", title: "Service Details", prompt: "Can you tell me what's going on with the vehicle?" },
  {
    id: "customer",
    title: "Customer Information",
    prompt: "Can I get your name and the best phone number to reach you?",
  },
  { id: "quote", title: "Pricing and Quote", prompt: "Here's what the service will cost." },
  { id: "convert", title: "Convert to Job", prompt: "Proceed with booking and dispatch." },
];

// Columns that exist, under the same name, on both `leads` and `jobs`.
// (The lead's email column is `email`, the job's is `client_email` — leads map
// it at the boundary, see lead-actions.ts.)
export const INTAKE_TEXT_COLUMNS = [
  "job_type",
  "service_street_address",
  "service_unit",
  "service_city",
  "state",
  "service_zip",
  "service_country",
  "service_location_notes",
  "vehicle_year",
  "vehicle_make",
  "vehicle_model",
  "vehicle_type",
  "color",
  "vin_or_lpn",
  "issue",
  "additional_service_details",
  "can_roll",
  "can_steer",
  "can_go_to_neutral",
  "tire_condition",
  "drivetrain",
  "with_good_spare_tire",
  "locking_lug_nut",
  "fuel_type",
  "tire_size",
  "trailer_type",
  "loaded_with",
  "trailer_weight",
  "trailer_length",
  "trailer_width",
  "trailer_height",
  "dropoff_street_address",
  "dropoff_unit",
  "dropoff_city",
  "dropoff_state",
  "dropoff_zip",
  "dropoff_country",
  "dropoff_instructions",
  "second_drop_off_location",
  "customer_name",
  "client_company_name",
  "customer_phone",
  "phone_extension",
  "client_email",
  "caller_id",
  "quote_notes",
] as const;

export const INTAKE_NUMBER_COLUMNS = [
  "service_latitude",
  "service_longitude",
  "number_of_gallons",
  "distance_miles",
  "additional_charges",
] as const;

type TextColumn = (typeof INTAKE_TEXT_COLUMNS)[number];
type NumberColumn = (typeof INTAKE_NUMBER_COLUMNS)[number];

export type IntakeFields = { [K in TextColumn]: string | null } & { [K in NumberColumn]: number | null } & {
  year_make_model: string | null;
  drop_off_location: string | null;
};

export function composeYearMakeModel(year: string | null, make: string | null, model: string | null): string | null {
  const joined = [year, make, model].filter(Boolean).join(" ");
  return joined === "" ? null : joined;
}

export function composeDropOffLocation(f: {
  dropoff_street_address: string | null;
  dropoff_unit: string | null;
  dropoff_city: string | null;
  dropoff_state: string | null;
  dropoff_zip: string | null;
  dropoff_country: string | null;
}): string | null {
  const line1 = [f.dropoff_street_address, f.dropoff_unit].filter(Boolean).join(", ");
  const cityStateZip = [f.dropoff_city, [f.dropoff_state, f.dropoff_zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const country = f.dropoff_country && f.dropoff_country.toUpperCase() !== "US" ? f.dropoff_country : null;
  const full = [line1, cityStateZip, country].filter(Boolean).join(", ");
  return full === "" ? null : full;
}

// Reads every shared intake column out of a submitted form. Year/Make/Model
// and the drop-off address are entered as separate fields but also stored as
// one composed string (year_make_model, drop_off_location) — that composed
// form is what the invoice, job detail page, and everything else already
// reads, so none of it needed to change.
export function intakeFieldsFromForm(formData: FormData): IntakeFields {
  const out: Record<string, string | number | null> = {};
  for (const col of INTAKE_TEXT_COLUMNS) out[col] = strOrNull(formData.get(col));
  for (const col of INTAKE_NUMBER_COLUMNS) out[col] = numberOrNull(formData.get(col));

  const fields = out as IntakeFields;
  fields.year_make_model = composeYearMakeModel(fields.vehicle_year, fields.vehicle_make, fields.vehicle_model);
  fields.drop_off_location = composeDropOffLocation(fields);
  return fields;
}

// Records created before the structured fields existed only have the composed
// strings. Splitting "2018 Toyota Camry" back into parts is a best-effort
// convenience so editing an old record doesn't present blank vehicle fields.
export function parseYearMakeModel(legacy: string | null | undefined): {
  year: string;
  make: string;
  model: string;
} {
  const tokens = (legacy ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { year: "", make: "", model: "" };
  let year = "";
  if (/^(19|20)\d{2}$/.test(tokens[0])) year = tokens.shift() as string;
  const make = tokens.shift() ?? "";
  return { year, make, model: tokens.join(" ") };
}

// Builds the string-valued defaults a form needs from a lead or job row.
export function intakeInitialFromRecord(rec: object | null | undefined): Record<string, string> {
  const r = (rec ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const out: Record<string, string> = {};

  for (const col of INTAKE_TEXT_COLUMNS) out[col] = str(r[col]);
  for (const col of INTAKE_NUMBER_COLUMNS) out[col] = str(r[col]);
  // Leads store the address as `email`, jobs as `client_email`.
  if (!out.client_email) out.client_email = str(r.email);

  if (!out.vehicle_year && !out.vehicle_make && !out.vehicle_model && r.year_make_model) {
    const p = parseYearMakeModel(str(r.year_make_model));
    out.vehicle_year = p.year;
    out.vehicle_make = p.make;
    out.vehicle_model = p.model;
  }

  const hasStructuredDropOff = [
    out.dropoff_street_address,
    out.dropoff_unit,
    out.dropoff_city,
    out.dropoff_state,
    out.dropoff_zip,
  ].some(Boolean);
  if (!hasStructuredDropOff && r.drop_off_location) out.dropoff_street_address = str(r.drop_off_location);

  for (const extra of ["quoted_price", "job_amount", "quote_status", "source", "notes", "agent", "dispatcher"]) {
    out[extra] = str(r[extra]);
  }
  return out;
}

// What the agent is asking about right now decides which fields exist. Until a
// Job Type is chosen, only the universally-applicable vehicle/issue fields show.
const UNTYPED_KEYS: JobDetailFieldKey[] = [
  "year_make_model",
  "vehicle_type",
  "color",
  "vin_or_lpn",
  "issue",
  "additional_service_details",
];

const STEP_FIELD_KEYS = {
  vehicle: ["year_make_model", "vehicle_type", "color", "vin_or_lpn"],
  details: [
    "issue",
    "additional_service_details",
    "can_roll",
    "can_steer",
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "with_good_spare_tire",
    "locking_lug_nut",
    "number_of_gallons",
    "fuel_type",
    "tire_size",
    "trailer_type",
    "loaded_with",
    "trailer_weight",
    "trailer_length",
    "trailer_width",
    "trailer_height",
  ],
  dropoff: ["drop_off_location", "second_drop_off_location", "distance_miles"],
  // Customer payment-authorization details belong to dispatch/booking, not the
  // initial call — they're surfaced in the operations step instead.
  card: ["customer_card_last4", "customer_billing_address"],
} satisfies Record<string, JobDetailFieldKey[]>;

export type IntakeFieldStep = keyof typeof STEP_FIELD_KEYS;

export function stepFieldKeys(step: IntakeFieldStep, jobType: string): JobDetailFieldKey[] {
  const allowed = JOB_TYPE_FIELD_KEYS[jobType] ?? UNTYPED_KEYS;
  return (STEP_FIELD_KEYS[step] as JobDetailFieldKey[]).filter((k) => allowed.includes(k));
}

export function jobTypeNeedsDropOff(jobType: string): boolean {
  return (JOB_TYPE_FIELD_KEYS[jobType] ?? []).includes("drop_off_location");
}

export function jobTypeHasSecondDropOff(jobType: string): boolean {
  return (JOB_TYPE_FIELD_KEYS[jobType] ?? []).includes("second_drop_off_location");
}

function cityState(city: string, state: string): string {
  return [city, state].filter(Boolean).join(", ");
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Live "current lead" panel contents, derived from whatever is in the form.
export function buildIntakeSummary(
  v: Record<string, string>,
  mode: "lead" | "job"
): { label: string; value: string }[] {
  const vehicle = [composeYearMakeModel(v.vehicle_year || null, v.vehicle_make || null, v.vehicle_model || null), v.color]
    .filter(Boolean)
    .join(" · ");
  const pickup = cityState(v.service_city ?? "", v.state ?? "") || v.service_street_address || "";
  const dropoff = cityState(v.dropoff_city ?? "", v.dropoff_state ?? "") || v.dropoff_street_address || "";
  const customer = [v.customer_name, v.customer_phone].filter(Boolean).join(" · ");

  const base = mode === "lead" ? Number(v.quoted_price) || 0 : Number(v.job_amount) || 0;
  const extra = mode === "lead" ? Number(v.additional_charges) || 0 : 0;
  const hasPrice = (mode === "lead" ? v.quoted_price : v.job_amount) !== "" && (mode === "lead" ? v.quoted_price : v.job_amount) !== undefined;

  const status =
    mode === "lead"
      ? QUOTE_STATUS_LABELS[(v.quote_status || "quoting") as QuoteStatus] ?? "Quoting"
      : v.job_status || "New job";

  const rows = [
    { label: "Service", value: v.job_type },
    { label: "Customer", value: customer },
    { label: "Vehicle", value: vehicle },
    { label: "Pickup", value: pickup },
    { label: "Drop-Off", value: dropoff },
    { label: "Quoted Price", value: hasPrice || extra ? money(base + extra) : "" },
    { label: "Status", value: status },
  ];
  return rows.map((r) => ({ label: r.label, value: r.value || "—" }));
}

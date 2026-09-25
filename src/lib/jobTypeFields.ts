import {
  CAN_GO_TO_NEUTRAL_OPTIONS,
  TIRE_CONDITION_OPTIONS,
  DRIVETRAIN_OPTIONS,
  GOOD_SPARE_TIRE_OPTIONS,
  LUG_NUT_OPTIONS,
  FUEL_TYPE_OPTIONS,
} from "./constants";

export type JobDetailFieldKey =
  | "year_make_model"
  | "vin_or_lpn"
  | "color"
  | "issue"
  | "can_go_to_neutral"
  | "tire_condition"
  | "drivetrain"
  | "service_location"
  | "drop_off_location"
  | "second_drop_off_location"
  | "distance_miles"
  | "customer_card_last4"
  | "customer_billing_address"
  | "with_good_spare_tire"
  | "locking_lug_nut"
  | "number_of_gallons"
  | "fuel_type"
  | "tire_size"
  | "trailer_type"
  | "loaded_with"
  | "trailer_weight"
  | "trailer_length"
  | "trailer_width"
  | "trailer_height";

interface JobDetailFieldDef {
  label: string;
  kind: "text" | "number" | "select" | "note";
  options?: string[];
}

// One definition per field concept — the single place to change a field's
// label, input type, or options so it stays consistent everywhere it's used.
export const JOB_DETAIL_FIELD_DEFS: Record<JobDetailFieldKey, JobDetailFieldDef> = {
  year_make_model: { label: "Year / Make / Model", kind: "text" },
  vin_or_lpn: { label: "VIN or LPN", kind: "text" },
  color: { label: "Color", kind: "text" },
  issue: { label: "Issue", kind: "text" },
  can_go_to_neutral: { label: "Can Go to Neutral", kind: "select", options: CAN_GO_TO_NEUTRAL_OPTIONS },
  tire_condition: { label: "Tire Condition", kind: "select", options: TIRE_CONDITION_OPTIONS },
  drivetrain: { label: "Drivetrain", kind: "select", options: DRIVETRAIN_OPTIONS },
  // Not stored — rendered as a note pointing back at the Service Location
  // section instead of asking the dispatcher to enter the address twice.
  service_location: { label: "Service Location", kind: "note" },
  drop_off_location: { label: "Drop-Off Location", kind: "text" },
  second_drop_off_location: { label: "Second Drop-Off Location", kind: "text" },
  distance_miles: { label: "Distance (miles)", kind: "number" },
  customer_card_last4: { label: "Last 4 Digits of Customer Card", kind: "text" },
  customer_billing_address: { label: "Billing Address of Customer", kind: "text" },
  with_good_spare_tire: { label: "With a Good Spare Tire", kind: "select", options: GOOD_SPARE_TIRE_OPTIONS },
  locking_lug_nut: { label: "Locking Lug Nut", kind: "select", options: LUG_NUT_OPTIONS },
  number_of_gallons: { label: "Number of Gallons", kind: "number" },
  fuel_type: { label: "Fuel Type", kind: "select", options: FUEL_TYPE_OPTIONS },
  tire_size: { label: "Tire Size", kind: "text" },
  trailer_type: { label: "Type of Trailer Attached", kind: "text" },
  loaded_with: { label: "Loaded With", kind: "text" },
  trailer_weight: { label: "Weight", kind: "text" },
  trailer_length: { label: "Length", kind: "text" },
  trailer_width: { label: "Width", kind: "text" },
  trailer_height: { label: "Height", kind: "text" },
};

const VEHICLE_BASE: JobDetailFieldKey[] = ["year_make_model", "vin_or_lpn", "color", "issue"];
const CARD_FIELDS: JobDetailFieldKey[] = ["customer_card_last4", "customer_billing_address"];

// Job Type -> which fields apply, in display order. Adding a job type or
// field later is just another entry here (plus a JOB_DETAIL_FIELD_DEFS
// entry for a genuinely new field) — no form restructuring needed.
export const JOB_TYPE_FIELD_KEYS: Record<string, JobDetailFieldKey[]> = {
  "Towing Service": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "service_location",
    "drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Heavy Duty Tow": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "service_location",
    "drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Non-Vehicle Tow": [
    ...VEHICLE_BASE,
    "tire_condition",
    "service_location",
    "drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Motorcycle Tow": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "service_location",
    "drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Lockout Service": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Winch Service": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "service_location",
    ...CARD_FIELDS,
  ],
  "Jump Start": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Tire Change": [
    ...VEHICLE_BASE,
    "with_good_spare_tire",
    "locking_lug_nut",
    "service_location",
    ...CARD_FIELDS,
  ],
  "Winch and Tow": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "service_location",
    "drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Heavy Duty Winch Out": [
    ...VEHICLE_BASE,
    "trailer_type",
    "loaded_with",
    "trailer_weight",
    "trailer_length",
    "trailer_width",
    "trailer_height",
    "service_location",
    ...CARD_FIELDS,
  ],
  "Fuel Delivery": [
    ...VEHICLE_BASE,
    "number_of_gallons",
    "fuel_type",
    "service_location",
    ...CARD_FIELDS,
  ],
  "Special Request (Non-Vehicle)": [...VEHICLE_BASE, "tire_condition", "service_location", ...CARD_FIELDS],
  "Special Request (Heavy Duty)": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "service_location",
    ...CARD_FIELDS,
  ],
  "Special Request": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "service_location",
    ...CARD_FIELDS,
  ],
  "Recovery Service": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Jump and Tow": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "service_location",
    "drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Tow and Storage": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "service_location",
    "drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Decking / Undecking": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Battery Replacement": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Locksmith Service": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Tire Replacement": [...VEHICLE_BASE, "tire_size", "service_location", ...CARD_FIELDS],
  "Fuel Delivery and Jump Start": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Lockout and Jump Start": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Tow and Lockout": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Tire Inflation": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Jump and Tire Change": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Two-Way Tow": [
    ...VEHICLE_BASE,
    "can_go_to_neutral",
    "tire_condition",
    "drivetrain",
    "service_location",
    "drop_off_location",
    "second_drop_off_location",
    "distance_miles",
    ...CARD_FIELDS,
  ],
  "Tire Change and Winch": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Jump and Fuel Delivery": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Winch Out and Fuel Delivery": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Tire Change and Tow": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Winch and Lockout Service": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Winch Out and Jump Start": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Heavy Duty Winch and Tow": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Fuel and Tow Service": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
  "Winch Out and Tow": [...VEHICLE_BASE, "service_location", ...CARD_FIELDS],
};

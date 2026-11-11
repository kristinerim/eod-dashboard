// Shown on the customer-facing invoice header.
export const COMPANY_NAME = "Quick Towing USA LLC";
export const COMPANY_PHONE = "(833) 836-0287";

// The agent and dispatcher names are no longer listed here: admins manage them from the
// Agents & Dispatchers page (the team_roster table).

export const US_STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR",
];

export const PLATFORMS = [
  "SLASH",
  "NEW AUTHORIZE",
  "BREX",
  "TAILOREDPAYNEW",
  "WORKIZPAY",
  "WORKIZ",
  "DIGITAS",
  "TAILOREDPAY",
];

export const ROLE_LABELS: Record<string, string> = {
  operations_manager: "Operations Manager",
  admin_coordinator: "Admin Coordinator",
  team_leader: "Team Leader",
  agent: "Agent",
};

export const LEAD_DISPOSITIONS = [
  "Price Too High",
  "Shopping Around",
  "No Answer",
  "Customer Declined",
  "Out of Coverage",
  "Follow-Up Needed",
  "Other",
];

export const INVOICE_STATUSES = ["Draft", "Sent", "Paid", "Partially Paid", "Voided", "Refunded"];

export const JOB_TYPES = [
  "Towing Service",
  "Heavy Duty Tow",
  "Non-Vehicle Tow",
  "Motorcycle Tow",
  "Lockout Service",
  "Winch Service",
  "Jump Start",
  "Tire Change",
  "Winch and Tow",
  "Heavy Duty Winch Out",
  "Fuel Delivery",
  "Special Request (Non-Vehicle)",
  "Special Request (Heavy Duty)",
  "Special Request",
  "Recovery Service",
  "Jump and Tow",
  "Tow and Storage",
  "Decking / Undecking",
  "Battery Replacement",
  "Locksmith Service",
  "Tire Replacement",
  "Fuel Delivery and Jump Start",
  "Lockout and Jump Start",
  "Tow and Lockout",
  "Tire Inflation",
  "Jump and Tire Change",
  "Two-Way Tow",
  "Tire Change and Winch",
  "Jump and Fuel Delivery",
  "Winch Out and Fuel Delivery",
  "Tire Change and Tow",
  "Winch and Lockout Service",
  "Winch Out and Jump Start",
  "Heavy Duty Winch and Tow",
  "Fuel and Tow Service",
  "Winch Out and Tow",
];

export const CAN_GO_TO_NEUTRAL_OPTIONS = ["Yes", "No", "Unknown"];
export const CAN_ROLL_OPTIONS = CAN_GO_TO_NEUTRAL_OPTIONS;
export const CAN_STEER_OPTIONS = CAN_GO_TO_NEUTRAL_OPTIONS;

export const VEHICLE_TYPE_OPTIONS = [
  "Car / Sedan",
  "SUV / Crossover",
  "Pickup Truck",
  "Van / Minivan",
  "Motorcycle",
  "RV / Motorhome",
  "Box Truck",
  "Semi / Tractor-Trailer",
  "Bus",
  "Trailer",
  "Other",
];

export const PAYMENT_AUTH_STATUSES = ["Not Requested", "Pending", "Authorized", "Declined", "Failed"];

// Where a lead sits in the quote conversation. "quoting" is the default until
// the agent explicitly saves the quote or records the customer's answer.
export const QUOTE_STATUSES = ["quoting", "quoted", "accepted", "declined", "follow_up"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  quoting: "Quoting",
  quoted: "Quote Saved",
  accepted: "Customer Accepted",
  declined: "Customer Declined",
  follow_up: "Follow-Up Needed",
};

export const TIRE_CONDITION_OPTIONS = ["Good", "Flat", "Blew Out", "Fell Off", "Damaged", "Unknown"];

export const DRIVETRAIN_OPTIONS = [
  "Front-Wheel Drive",
  "Rear-Wheel Drive",
  "Four-Wheel Drive",
  "All-Wheel Drive",
  "Unknown",
];

export const GOOD_SPARE_TIRE_OPTIONS = ["Yes", "No", "N/A"];

export const LUG_NUT_OPTIONS = ["Regular Lug Nut", "Locking Lug Nut With Key"];

export const FUEL_TYPE_OPTIONS = ["Regular", "Diesel"];

export const FINAL_CHECK_OPTIONS = [
  "Completed",
  "Needs Attention",
  "Check Notes",
  "No Picture from Vendor",
  "No Customer's Written Confirmation",
  "Vendor Has No Picture",
  "No Picture and No Written Confirmation",
];

export const PENDING_COMPLETION_STATUS = "Service Rendered – Pending Completion";

export const JOB_STATUS_SUGGESTIONS = [
  "Appointment",
  "Converted",
  "Dispatched",
  "In Progress",
  "On Hold",
  "Needs Attention",
  PENDING_COMPLETION_STATUS,
  "Completed",
  "Cancelled",
];

export const PENDING_COMPLETION_SUBSTATUSES = [
  "Completed (Confirmed by Client and Vendor with Photos)",
  "Completed (Confirmed by Vendor Only with Photos)",
  "Completed (Confirmed by Vendor Without Photos)",
  "Completed (Confirmed by Client and Vendor Without Photos)",
  "Completed (Confirmed by Client – Written Confirmation Only)",
  "Completed (Confirmed by Client, but no written confirmation, and Vendor with Pics)",
  "Completed (Endorsed to Vendor)",
  "Ongoing Damage Claim",
  "On Hold",
  "Needs Attention",
];

// The team's Google My Maps vendor map (read-only viewer link) and the Hub's
// own full vendor list, offered from the Recommended Vendors section.
export const VENDOR_MAP_URL = "https://www.google.com/maps/d/viewer?mid=1CNjaav1RH4oD1ZCvO0ZcBTTMqiL616U";

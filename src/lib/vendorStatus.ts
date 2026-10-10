// A vendor's response on ONE job. This is never the vendor's permanent
// classification (Preferred / Non Preferred / DNC): marking a Preferred vendor
// No-Go for a job does not touch the Vendors directory.

export const CONTACT_STATUSES = ["called", "no_go", "go"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

// What the dropdown offers. "Not Contacted" has no stored row.
export type DropdownStatus = ContactStatus | "not_contacted";

export const STATUS_LABELS: Record<DropdownStatus, string> = {
  not_contacted: "Not Contacted",
  called: "Called",
  no_go: "No-Go",
  go: "Go",
};

export function isContactStatus(value: unknown): value is ContactStatus {
  return typeof value === "string" && (CONTACT_STATUSES as readonly string[]).includes(value);
}

// "20", "20 min", "45 mins", "1 hr", "1.5 hours", "1 hr 15 min", "1:30" -> minutes.
// Returns null when the text isn't clearly a duration, so nothing is guessed.
export function parseEtaMinutes(text: string | null | undefined): number | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;

  const clock = t.match(/^(\d{1,2}):(\d{2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);

  let total = 0;
  let matched = false;
  const hours = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (hours) {
    total += Math.round(Number(hours[1]) * 60);
    matched = true;
  }
  const mins = t.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  if (mins) {
    total += Math.round(Number(mins[1]));
    matched = true;
  }
  if (matched) return total;

  // A bare number is minutes.
  if (/^\d+(?:\.\d+)?$/.test(t)) return Math.round(Number(t));
  return null;
}

// The job's "Preferred vendor" field for a given classification.
export function preferredVendorAnswer(tier: string | null | undefined): "Yes" | "No" {
  return tier === "preferred" ? "Yes" : "No";
}

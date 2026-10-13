// A lead needs at least one way to reach the customer: a valid phone number OR
// a valid email address. Neither is required on its own. Shared by the Add
// Lead form (to enable the Save button) and the server (which enforces it).

// Phone: 10 to 15 digits once spaces, dashes, brackets and a leading "+" are
// ignored, so "(555) 000-9999", "555-000-9999" and "+1 555 000 9999" all count.
export function isValidPhone(value: string | null | undefined): boolean {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export function isValidEmail(value: string | null | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((value ?? "").trim());
}

export function hasValidContact(phone: string | null | undefined, email: string | null | undefined): boolean {
  return isValidPhone(phone) || isValidEmail(email);
}

export const CONTACT_REQUIRED_MESSAGE =
  "Enter a valid customer phone number or email address (one is enough) before saving the lead.";

// Pure helpers for turning messy Google My Maps vendor data into clean,
// comparable values. No I/O — shared by the dry-run script and (later) the
// real import.

export type Tier =
  | "preferred"
  | "non_preferred"
  | "dnc_tier_1"
  | "dnc_tier_2"
  | "dnc_tier_3"
  | "unclassified";

// Higher = more restrictive. When two sources disagree about a vendor, the
// more restrictive tier wins so a do-not-use vendor can never be recommended
// by accident.
export const TIER_STRICTNESS: Record<Tier, number> = {
  unclassified: -1,
  preferred: 0,
  non_preferred: 1,
  dnc_tier_1: 2,
  dnc_tier_2: 3,
  dnc_tier_3: 4,
};

export function strictestTier(a: Tier, b: Tier): Tier {
  return TIER_STRICTNESS[a] >= TIER_STRICTNESS[b] ? a : b;
}

export function tierFromStatus(status: string): Tier | null {
  const s = status.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (s === "preferred") return "preferred";
  if (s === "non preferred" || s === "nonpreferred" || s === "non pref") return "non_preferred";
  const dnc = /^dnc tier ([123])$/.exec(s);
  if (dnc) return `dnc_tier_${dnc[1]}` as Tier;
  return null;
}

// Only these layers say anything about classification. "Remaining Vendors" and
// "HD Vendors" hold a mix of statuses, so their layer is NOT evidence of a tier.
export function tierFromLayer(layer: string): Tier | null {
  const l = layer.toLowerCase().trim();
  if (l === "preferred vendors") return "preferred";
  if (l === "non pref vendors") return "non_preferred";
  const dnc = /^dnc tier ([123])$/.exec(l);
  if (dnc) return `dnc_tier_${dnc[1]}` as Tier;
  return null;
}

export function normalizePhone10(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Spreadsheets sometimes turned phone numbers into floats ("9.705230775E9");
  // a 10-digit number is exactly representable, so the digits are recoverable.
  if (/^\s*\d(?:\.\d+)?E\+?\d+\s*$/i.test(raw)) raw = String(Math.round(Number(raw)));
  const m = /(?:\+?1[\s.\-]*)?\(?(\d{3})\)?[\s.\-]*(\d{3})[\s.\-]*(\d{4})/.exec(raw);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

export function formatPhone(digits: string | null): string {
  return digits ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : "";
}

const NAME_NOISE = new Set(["inc", "llc", "corp", "co", "company", "ltd", "the", "and", "of"]);

export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !NAME_NOISE.has(t))
    .join(" ");
}

// Street number + first street word + ZIP — enough to tell "same place" from
// "different branch" without needing real geocoding.
export function addressKey(address: string): string {
  const a = address.toLowerCase();
  const street = /^\s*(\d+)\s+([a-z0-9]+)/.exec(a);
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(a);
  return [street ? `${street[1]} ${street[2]}` : "", zip ? zip[1] : ""].join("|");
}

export function addressesCompatible(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return true;
  const ka = addressKey(a);
  const kb = addressKey(b);
  if (ka === "|" || kb === "|") return true;
  const [sa, za] = ka.split("|");
  const [sb, zb] = kb.split("|");
  const streetOk = !sa || !sb || sa === sb;
  const zipOk = !za || !zb || za === zb;
  return streetOk && zipOk;
}

export type LocationQuality = "point" | "latlong_in_address" | "street_address" | "city_only" | "none";

const LATLONG = /^\s*(-?\d{1,3}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)\s*$/;

export function parseLatLongText(text: string): { lat: number; lng: number } | null {
  const m = LATLONG.exec(text);
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

// Plausible for the US (incl. Alaska, Hawaii, Puerto Rico) and nearby Canada.
export function coordsPlausible(lat: number, lng: number): boolean {
  return lat >= 15 && lat <= 72 && lng >= -170 && lng <= -50;
}

export function classifyAddress(address: string): "street_address" | "city_only" | "none" {
  const a = address.trim();
  if (!a || /^(n\/?a|none|unknown|-+)$/i.test(a) || a.includes("@")) return "none";
  if (/^\d+\s+\S+/.test(a)) return "street_address";
  return /[A-Za-z]{3,}/.test(a) ? "city_only" : "none";
}

export function extractState(address: string): string | null {
  const m = /,\s*([A-Z]{2})\b(?:[,\s]+(?:United States[,\s]+)?\d{5}(?:-\d{4})?)?\s*$/.exec(address.trim());
  if (m) return m[1];
  const m2 = /\b([A-Z]{2})\s+\d{5}\b/.exec(address);
  return m2 ? m2[1] : null;
}

const CANADIAN_POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[A-Z][\s-]?\d[A-Z]\d\b/i;
const US_STATE_ZIP = /\b[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?\b/;

// A US state + ZIP in the address beats a "Canada" note — the note may be a
// leftover — but that disagreement is flagged for a human to look at.
export function detectCountry(address: string, notes: string): { country: "US" | "CA"; conflict: boolean } {
  const strongCanada =
    /\bcanada\b/i.test(address) ||
    CANADIAN_POSTAL.test(address) ||
    /,\s*(ON|BC|AB|QC|MB|SK|NS|NB|NL|PE|PEI|YT|NT|NU)\b[\s,.]*(?:[A-Z]\d[A-Z]|canada|$)/.test(address);
  const notesSayCanada = /canad/i.test(notes);
  const usAddress = US_STATE_ZIP.test(address);

  if (usAddress) return { country: "US", conflict: strongCanada || notesSayCanada };

  // Coordinates-only entries: well south of the border and west of Ontario
  // there is no Canadian land, so a "Canada" note there is a mistake (e.g. a
  // Montana vendor tagged CANADA VENDOR) — keep it, flag it.
  const ll = parseLatLongText(address);
  if (ll && ll.lat < 49 && ll.lng < -95) return { country: "US", conflict: notesSayCanada };
  if (strongCanada || notesSayCanada) return { country: "CA", conflict: false };
  if (ll && ll.lat >= 49.5 && ll.lng > -141) return { country: "CA", conflict: false };
  return { country: "US", conflict: false };
  return { country: "US", conflict: false };
}

// Some entries wrap several yards in one address; the first line (minus a
// "Main Yard:" style label) is the one to place on the map.
export function primaryAddress(address: string): string {
  const first = address.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return first.replace(/^[A-Za-z][A-Za-z ]{0,25}:\s*/, "");
}

// Dispatchers have written the DNC tier into vendor names ("DNC T3 Smith's
// Towing", "Ernie's Towing - DNC 3", "(DNC Tier 1)") and notes. That is real
// classification evidence — and sometimes contradicts the Status column.
export function tierFromMarkerText(text: string): { tier: Tier | null; unspecified: boolean } {
  const numbered = /dnc[\s_*\-\[\]()]*(?:tier|t)?[\s_]*([123])\b/i.exec(text);
  if (numbered) return { tier: `dnc_tier_${numbered[1]}` as Tier, unspecified: false };
  const mentionsDnc = /\bdnc\b/i.test(text) || /do\s*not\s*use/i.test(text);
  return { tier: null, unspecified: mentionsDnc };
}

// Name with the DNC decoration removed ("***DNC***Kings Towing***DNC***" ->
// "Kings Towing"). The original is always kept alongside.
export function cleanVendorName(name: string): string {
  return name
    .replace(/\[?\(?\bdnc(?:[\s_*\-]*(?:tier|t)?[\s_]*[123])?\b\)?\]?/gi, " ")
    .replace(/do\s*not\s*use/gi, " ")
    .replace(/[*!_]+/g, " ")
    .replace(/\s+-\s+$|^\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Services are free text in the map ("Light Duty", "LD Tow", "Light-Duty
// Towing" all mean the same thing). These categories are what the nearest-
// vendor search will match against the requested Job Type.
export const SERVICE_CATEGORIES = [
  "light_duty_tow",
  "medium_duty_tow",
  "heavy_duty_tow",
  "flatbed_tow",
  "towing_general",
  "roadside_general",
  "tire_service",
  "lockout",
  "jump_start",
  "battery_service",
  "fuel_delivery",
  "winch_recovery",
  "auto_repair",
  "transport_hauling",
  "impound_storage",
  "junk_removal",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

const NOISE_TOKEN = /^(services?( offered| provided)?:?|"+|n\/?a|none|-+|long distance|special requests?)$/i;

export function splitList(value: string): string[] {
  return value
    .split(/[\n;,]+/)
    .map((t) => t.trim().replace(/[-–\s]+$/, ""))
    .filter((t) => t && !NOISE_TOKEN.test(t));
}

const MEDIUM_WORD = /\b(medium|meduim|mediutm|mediuim|medum)\b/;

export function categorizeService(token: string): ServiceCategory[] {
  const t = token.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const out = new Set<ServiceCategory>();

  const light = /\b(light|ld)\b/.test(t);
  const medium = MEDIUM_WORD.test(t) || /\bmd\b/.test(t);
  const heavy = /\b(heavy|hd)\b/.test(t) && !/heavy haul/.test(t);
  if (light) out.add("light_duty_tow");
  if (medium) out.add("medium_duty_tow");
  if (heavy) out.add("heavy_duty_tow");
  // "Light to Heavy" is a range, so it includes medium.
  if (light && heavy) out.add("medium_duty_tow");

  if (/flatbed|roll ?back|lowboy|wheel lift|car carrier/.test(t)) out.add("flatbed_tow");
  if (/\broad ?s[a-z]{2,5}\b|roadside|raodside/.test(t)) out.add("roadside_general");
  if (/tire/.test(t)) out.add("tire_service");
  if (/lock ?out|locksmith/.test(t)) out.add("lockout");
  if (/jump/.test(t)) out.add("jump_start");
  if (/battery/.test(t)) out.add("battery_service");
  if (/fuel|gas delivery/.test(t)) out.add("fuel_delivery");
  if (/winch|recover|extrication|off road|accident|load shift|load transfer/.test(t)) out.add("winch_recovery");
  if (/transport|haul|shipping/.test(t)) out.add("transport_hauling");
  if (/impound|storage/.test(t)) out.add("impound_storage");
  if (/junk|scrap|salvage/.test(t)) out.add("junk_removal");
  if (/repair|mechanic|body shop|collision|diagnos|brake|oil change|maintenance|key programming|fleet/.test(t) && !/tire/.test(t)) {
    out.add("auto_repair");
  }

  const hasTow = [...out].some((c) => c.endsWith("_tow"));
  if (!hasTow && /\b(tow|tows|towing|wrecker|rv tows?)\b/.test(t)) out.add("towing_general");
  return [...out];
}

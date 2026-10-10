import type { RawPin } from "./parseMyMaps";
import {
  addressesCompatible,
  categorizeService,
  classifyAddress,
  coordsPlausible,
  extractState,
  cleanVendorName,
  detectCountry,
  primaryAddress,
  tierFromMarkerText,
  TIER_STRICTNESS,
  nameKey,
  normalizePhone10,
  parseLatLongText,
  splitList,
  strictestTier,
  tierFromLayer,
  tierFromStatus,
  type LocationQuality,
  type ServiceCategory,
  type Tier,
} from "./normalize";

export interface VendorCandidate {
  name: string;
  nameOriginal: string;
  contactName: string;
  phone: string | null;
  secondaryPhone: string | null;
  email: string;
  secondaryEmail: string;
  address: string;
  state: string | null;
  lat: number | null;
  lng: number | null;
  locationQuality: LocationQuality;
  services: string[];
  serviceCategories: ServiceCategory[];
  unmappedServices: string[];
  equipment: string[];
  statusRaw: string;
  tier: Tier;
  // Where the tier came from: the map as exported, or a human decision made
  // during the review of the dry-run preview (which must survive re-imports).
  tierSource: "map" | "review";
  tierReason: string;
  reviewNote: string;
  layers: string[];
  notes: string;
  heavyDutyCapable: boolean;
  mergedFrom: number;
  flags: string[];
}

export interface DuplicateGroup {
  phone: string;
  decision: "merged" | "needs_review";
  reason: string;
  members: { name: string; layer: string; statusRaw: string; address: string }[];
}

export interface ImportPlan {
  totalPins: number;
  vendors: VendorCandidate[];
  excludedCanadian: VendorCandidate[];
  duplicateGroups: DuplicateGroup[];
}

function pinToCandidate(pin: RawPin): VendorCandidate {
  const d = pin.data;
  const flags: string[] = [];

  const statusRaw = d.Status ?? "";
  const fromStatus = tierFromStatus(statusRaw);
  const fromLayer = tierFromLayer(pin.layer);
  const marker = tierFromMarkerText(`${pin.name} ${d.Notes ?? ""}`);

  // The most restrictive evidence wins, so a vendor marked do-not-use anywhere
  // (Status, layer, or written into the name/notes) can't be recommended.
  const evidence = [fromStatus, fromLayer, marker.tier].filter((t): t is Tier => t !== null);
  let tier: Tier = evidence.length > 0 ? evidence.reduce(strictestTier) : "unclassified";

  if (fromStatus && fromLayer && fromStatus !== fromLayer) flags.push("status_layer_conflict");
  if (!fromStatus) {
    const kind = statusRaw ? "status_unrecognized" : "status_blank";
    flags.push(fromLayer || marker.tier ? `${kind}_used_layer` : kind);
  }
  if (marker.tier && fromStatus && TIER_STRICTNESS[marker.tier] > TIER_STRICTNESS[fromStatus]) {
    flags.push("name_says_stricter_tier_than_status");
  }
  // Name/notes say "DNC" with no tier, but nothing else says do-not-use: hold
  // the vendor out of recommendations until a person decides the tier.
  if (marker.unspecified && !tier.startsWith("dnc_")) {
    tier = "unclassified";
    flags.push("name_says_dnc_status_disagrees");
  }

  const phone = normalizePhone10(d.Phone);
  if (!phone) flags.push("no_phone");

  let addressFull = d["Complete Address"] || pin.address;
  let email = d.Email ?? "";
  // An email address typed into the address field is not a location.
  if (addressFull.includes("@")) {
    if (!email) email = addressFull.trim();
    flags.push("email_found_in_address_field");
    addressFull = "";
  }
  const addressText = primaryAddress(addressFull);
  let lat: number | null = null;
  let lng: number | null = null;
  let locationQuality: LocationQuality;
  const fromText = parseLatLongText(addressText);
  if (pin.point) {
    lat = pin.point.lat;
    lng = pin.point.lng;
    locationQuality = "point";
  } else if (fromText) {
    lat = fromText.lat;
    lng = fromText.lng;
    locationQuality = "latlong_in_address";
  } else {
    locationQuality = classifyAddress(addressText);
  }
  if (lat !== null && lng !== null && !coordsPlausible(lat, lng)) {
    flags.push("coordinates_out_of_range");
    lat = null;
    lng = null;
    locationQuality = classifyAddress(addressText);
  }
  if (locationQuality === "none") flags.push("no_location");
  if (locationQuality === "city_only") flags.push("city_level_location_only");

  const services = splitList(d.Services ?? "");
  const serviceCategories = new Set<ServiceCategory>();
  const unmappedServices: string[] = [];
  for (const token of services) {
    const cats = categorizeService(token);
    if (cats.length === 0) unmappedServices.push(token);
    cats.forEach((c) => serviceCategories.add(c));
  }
  if (services.length === 0) flags.push("services_blank");

  const heavyDutyCapable = pin.layer.toLowerCase() === "hd vendors" || serviceCategories.has("heavy_duty_tow");

  return {
    name: cleanVendorName(pin.name) || pin.name,
    nameOriginal: pin.name,
    contactName: d["Contact Name"] ?? "",
    phone,
    secondaryPhone: normalizePhone10(d["Secondary Phone"]),
    email,
    secondaryEmail: d["Secondary Email"] ?? "",
    address: addressFull,
    state: extractState(addressText),
    lat,
    lng,
    locationQuality,
    services,
    serviceCategories: [...serviceCategories],
    unmappedServices,
    equipment: splitList(d.Equipment ?? ""),
    statusRaw,
    tier,
    tierSource: "map",
    tierReason: "",
    reviewNote: "",
    layers: [pin.layer],
    notes: d.Notes ?? "",
    heavyDutyCapable,
    mergedFrom: 1,
    flags,
  };
}

function mergeInto(base: VendorCandidate, other: VendorCandidate) {
  base.tier = strictestTier(base.tier, other.tier);
  base.layers = [...new Set([...base.layers, ...other.layers])];
  base.services = [...new Set([...base.services, ...other.services])];
  base.serviceCategories = [...new Set([...base.serviceCategories, ...other.serviceCategories])];
  base.unmappedServices = [...new Set([...base.unmappedServices, ...other.unmappedServices])];
  base.equipment = [...new Set([...base.equipment, ...other.equipment])];
  base.heavyDutyCapable = base.heavyDutyCapable || other.heavyDutyCapable;
  base.secondaryPhone ||= other.secondaryPhone;
  base.contactName ||= other.contactName;
  base.email ||= other.email;
  base.secondaryEmail ||= other.secondaryEmail;
  base.notes = base.notes || other.notes;
  if (base.lat === null && other.lat !== null) {
    base.lat = other.lat;
    base.lng = other.lng;
    base.locationQuality = other.locationQuality;
  }
  base.mergedFrom += other.mergedFrom;
  // The merged vendor may now have a usable status/services even if one copy didn't.
  base.flags = base.flags.filter((f) => !(f === "services_blank" && base.services.length > 0));
  if (!base.flags.includes("merged_duplicates")) base.flags.push("merged_duplicates");
}

// Turns raw map pins into the vendors we would create. Pure — writes nothing.
export function mergeVendorInto(base: VendorCandidate, other: VendorCandidate) {
  mergeInto(base, other);
}

export function buildImportPlan(pins: RawPin[]): ImportPlan {
  const candidates = pins.map((p) => ({ pin: p, c: pinToCandidate(p) }));

  const excludedCanadian: VendorCandidate[] = [];
  const us: VendorCandidate[] = [];
  for (const { c } of candidates) {
    const { country, conflict } = detectCountry(primaryAddress(c.address), c.notes);
    if (country === "CA") {
      c.flags.push("canadian_excluded");
      excludedCanadian.push(c);
    } else {
      if (conflict) c.flags.push("address_is_us_but_notes_or_address_mention_canada");
      us.push(c);
    }
  }

  // Same phone number = probably the same vendor. Merge only when the name and
  // address also agree; otherwise it could be a different branch, so leave both
  // and ask a human.
  const byPhone = new Map<string, VendorCandidate[]>();
  for (const c of us) {
    if (!c.phone) continue;
    const list = byPhone.get(c.phone) ?? [];
    list.push(c);
    byPhone.set(c.phone, list);
  }

  const dropped = new Set<VendorCandidate>();
  const duplicateGroups: DuplicateGroup[] = [];
  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue;
    const members = group.map((m) => ({
      name: m.name,
      layer: m.layers[0],
      statusRaw: m.statusRaw,
      address: m.address,
    }));
    const [first, ...rest] = group;
    const sameVendor = rest.every(
      (m) => nameKey(m.name) === nameKey(first.name) && addressesCompatible(m.address, first.address)
    );
    if (sameVendor) {
      for (const m of rest) {
        mergeInto(first, m);
        dropped.add(m);
      }
      duplicateGroups.push({ phone, decision: "merged", reason: "Same phone, name, and address", members });
    } else {
      for (const m of group) if (!m.flags.includes("possible_duplicate")) m.flags.push("possible_duplicate");
      duplicateGroups.push({
        phone,
        decision: "needs_review",
        reason: "Same phone number but the name or address differs",
        members,
      });
    }
  }

  return {
    totalPins: pins.length,
    vendors: us.filter((c) => !dropped.has(c)),
    excludedCanadian,
    duplicateGroups,
  };
}

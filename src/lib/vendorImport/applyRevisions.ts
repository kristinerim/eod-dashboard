import {
  mergeVendorInto,
  type ImportPlan,
  type VendorCandidate,
} from "./buildVendors";
import {
  addressesCompatible,
  categorizeService,
  classifyAddress,
  extractState,
  formatPhone,
  nameKey,
  normalizePhone10,
  parseLatLongText,
  primaryAddress,
  splitList,
  tierFromStatus,
  TIER_STRICTNESS,
  type ServiceCategory,
  type Tier,
} from "./normalize";

// Applies the decisions a human wrote into the "Revision" column of the dry-run
// workbook. Pure: takes the plan plus the sheet rows, returns a new plan and a
// log of everything it did (and everything it could not decide).

export interface RevisionRow {
  sheet: "Needs review" | "DNC name conflicts";
  excelRow: number;
  cells: Record<string, unknown>;
}

export interface ChangeLogEntry {
  vendor: string;
  phone: string;
  change: string;
  basedOn: string;
}

export interface OpenItem {
  vendor: string;
  phone: string;
  issue: string;
  yourNote: string;
}

export interface RevisionResult {
  plan: ImportPlan;
  changes: ChangeLogEntry[];
  open: OpenItem[];
  removedAsDuplicate: VendorCandidate[];
  stats: Record<string, number>;
}

const str = (v: unknown) => String(v ?? "").replace(/\r/g, "").trim();
const oneLine = (v: unknown) => str(v).replace(/\s+/g, " ");

const digits = (v: unknown) => str(v).replace(/\D/g, "");

export function parseRevisionTier(text: string): { tier: Tier | null; reason: string } {
  const t = oneLine(text);
  const dnc = /dnc\s*tier\s*([123])/i.exec(t);
  if (dnc) {
    const reason = t
      .slice(dnc.index + dnc[0].length)
      .replace(/^[\s.;:,]+/, "")
      .trim();
    return { tier: `dnc_tier_${dnc[1]}` as Tier, reason };
  }
  const dest = /\bto\s+(non[\s-]?preferred|preferred)\b/i.exec(t);
  const any = /\b(non[\s-]?preferred|preferred)\b/i.exec(t);
  const m = dest ?? any;
  if (!m) return { tier: null, reason: "" };
  const tier: Tier = /non/i.test(m[1]) ? "non_preferred" : "preferred";
  return { tier, reason: t };
}

const BLOCK_LABELS = [
  "Contact Name",
  "Phone",
  "Secondary Phone",
  "Email",
  "Secondary Email",
  "Complete Address",
  "Services",
  "Equipment",
  "Status",
];

interface CanonicalBlock {
  name: string;
  values: Record<string, string>;
}

// "Same vendor, duplicate entries. Use the ff info: <name> <Label> <value> ..."
function parseCanonicalBlock(text: string): CanonicalBlock | null {
  const lines = str(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const start = lines.findIndex((l) => /use the ff info/i.test(l));
  if (start === -1) return null;
  const body = lines.slice(start + 1);
  const name = body[0] ?? "";
  const values: Record<string, string> = {};
  let label: string | null = null;
  for (const line of body.slice(1)) {
    if (BLOCK_LABELS.includes(line)) {
      label = line;
      values[label] = "";
    } else if (label) {
      const v = /^no value$/i.test(line) ? "" : line;
      values[label] = values[label] ? `${values[label]}, ${v}` : v;
    }
  }
  return { name, values };
}

function setLocation(v: VendorCandidate, address: string) {
  const clean = address.replace(/[\s.,]+$/, "").trim();
  v.address = clean;
  const ll = parseLatLongText(clean);
  v.flags = v.flags.filter((f) => !["no_location", "city_level_location_only"].includes(f));
  if (ll) {
    v.lat = ll.lat;
    v.lng = ll.lng;
    v.locationQuality = "latlong_in_address";
  } else {
    v.locationQuality = classifyAddress(primaryAddress(clean));
    // Keep real coordinates if the vendor already has them; otherwise it needs a lookup.
    if (v.locationQuality === "city_only") v.flags.push("city_level_location_only");
    if (v.locationQuality === "none") v.flags.push("no_location");
  }
  v.state = extractState(primaryAddress(clean));
}

function setServices(v: VendorCandidate, raw: string) {
  const services = splitList(raw.replace(/,/g, "\n"));
  const cats = new Set<ServiceCategory>();
  const unmapped: string[] = [];
  for (const s of services) {
    const c = categorizeService(s);
    if (c.length === 0) unmapped.push(s);
    c.forEach((x) => cats.add(x));
  }
  v.services = services;
  v.serviceCategories = [...cats];
  v.unmappedServices = unmapped;
  v.heavyDutyCapable = v.layers.some((l) => l.toLowerCase() === "hd vendors") || cats.has("heavy_duty_tow");
  v.flags = v.flags.filter((f) => f !== "services_blank");
  if (services.length === 0) v.flags.push("services_blank");
}

const RESOLVED_BY_REVIEW = [
  "name_says_dnc_status_disagrees",
  "name_says_stricter_tier_than_status",
  "status_layer_conflict",
  "status_blank",
  "status_unrecognized",
  "status_blank_used_layer",
  "status_unrecognized_used_layer",
  "possible_duplicate",
];

export function applyRevisions(plan: ImportPlan, rows: RevisionRow[]): RevisionResult {
  const vendors = plan.vendors.map((v) => ({ ...v, flags: [...v.flags] }));
  const excludedCanadian = plan.excludedCanadian.map((v) => ({ ...v }));
  const changes: ChangeLogEntry[] = [];
  const open: OpenItem[] = [];
  const removedAsDuplicate: VendorCandidate[] = [];
  const removed = new Set<VendorCandidate>();

  const log = (v: VendorCandidate, change: string, basedOn: string) =>
    changes.push({ vendor: v.name, phone: formatPhone(v.phone), change, basedOn });

  // ---- 1. match each revised row to a vendor in the plan -------------------
  const claimed = new Set<VendorCandidate>();
  // Best match by phone number first (it's the vendor's identity), then by
  // how many of the unedited columns agree. Names are NOT trusted — some were
  // edited, and a couple were overwritten by accident in the sheet.
  function matchRow(r: RevisionRow): VendorCandidate | null {
    const phone = digits(r.cells["Phone"]);
    const phoneless = vendors.filter((v) => !v.phone);
    const wantsPhoneless = /phone number added/i.test(str(r.cells["Revision"]));

    let cands = vendors.filter((v) => phone && v.phone === phone);
    if (wantsPhoneless || cands.length === 0) cands = phoneless;
    if (cands.length === 0) return null;

    const layers = oneLine(r.cells["Source layers"]);
    const services = oneLine(r.cells["Services (original)"]);
    const equipment = oneLine(r.cells["Equipment"]);
    const orig = nameKey(str(r.cells["Name in map (original)"]) || str(r.cells["Name"]));
    const score = (v: VendorCandidate) =>
      (oneLine(v.layers.join(" + ")) === layers ? 3 : 0) +
      (oneLine(v.services.join("; ")) === services ? 2 : 0) +
      (oneLine(v.equipment.join("; ")) === equipment ? 1 : 0) +
      (nameKey(v.nameOriginal) === orig || nameKey(v.name) === orig ? 2 : 0) +
      (claimed.has(v) && r.sheet === "Needs review" ? -5 : 0);
    return cands.reduce((best, v) => (score(v) > score(best) ? v : best), cands[0]);
  }

  const matched = new Map<RevisionRow, VendorCandidate>();
  const rowToVendor = new Map<number, VendorCandidate>(); // "Needs review" excel row -> vendor
  let unmatched = 0;
  // The "Needs review" sheet holds every vendor; match it first and claim them.
  for (const r of rows.filter((x) => x.sheet === "Needs review")) {
    const v = matchRow(r);
    if (v) {
      matched.set(r, v);
      claimed.add(v);
      rowToVendor.set(r.excelRow, v);
    } else {
      unmatched++;
      open.push({ vendor: str(r.cells["Name"]), phone: str(r.cells["Phone"]), issue: "Could not match this row to a vendor", yourNote: oneLine(r.cells["Revision"]) });
    }
  }
  for (const r of rows.filter((x) => x.sheet === "DNC name conflicts")) {
    const v = matchRow(r);
    if (v) matched.set(r, v);
    else {
      unmatched++;
      open.push({ vendor: str(r.cells["Name"]), phone: str(r.cells["Phone"]), issue: "Could not match this row to a vendor", yourNote: oneLine(r.cells["Revision"]) });
    }
  }

  // ---- 2. collect decisions per vendor, checking the two sheets agree ----------
  interface Decision {
    note: string;
    tier: Tier | null;
    reason: string;
    rows: RevisionRow[];
  }
  const decisions = new Map<VendorCandidate, Decision>();
  for (const [r, v] of matched) {
    const note = str(r.cells["Revision"]);
    if (!note) continue;
    if (/use the ff info/i.test(note)) continue; // handled as a merge below
    const { tier, reason } = parseRevisionTier(note);
    const prev = decisions.get(v);
    if (!prev) {
      decisions.set(v, { note: oneLine(note), tier, reason, rows: [r] });
      continue;
    }
    // Same vendor appears on both sheets — the decisions should agree.
    if (prev.tier && tier && prev.tier !== tier) {
      open.push({
        vendor: v.name,
        phone: formatPhone(v.phone),
        issue: `The two sheets give different tiers (${prev.tier} vs ${tier}); used the stricter`,
        yourNote: `${prev.note} // ${oneLine(note)}`,
      });
      if (TIER_STRICTNESS[tier] > TIER_STRICTNESS[prev.tier]) {
        prev.tier = tier;
        prev.reason = reason;
        prev.note = oneLine(note);
      }
    } else if (!prev.tier && tier) {
      prev.tier = tier;
      prev.reason = reason;
      prev.note = oneLine(note);
    }
    prev.rows.push(r);
  }

  // ---- 3. apply tier / name / address / phone / notes edits ------------------
  const NO_ROW_EDITS = /vendor in canada|same as row|double entry|vendor not found|use the ff info/i;
  for (const [v, d] of decisions) {
    if (NO_ROW_EDITS.test(d.note)) continue;
    const row = d.rows[0];
    const before = v.tier;

    if (d.tier) {
      v.tier = d.tier;
      v.tierSource = "review";
      v.tierReason = d.reason;
      v.flags = v.flags.filter((f) => !RESOLVED_BY_REVIEW.includes(f));
      if (before !== d.tier) log(v, `Tier ${before} -> ${d.tier}${d.reason && d.tier.startsWith("dnc") ? ` (${d.reason})` : ""}`, d.note);
      // Cross-check against what the sheet cells say.
      const cellStatus = tierFromStatus(str(row.cells["Original Status"]));
      if (cellStatus && cellStatus !== d.tier) {
        open.push({ vendor: v.name, phone: formatPhone(v.phone), issue: `Your note says ${d.tier} but the Original Status cell says ${cellStatus}; used your note`, yourNote: d.note });
      }
    }
    v.reviewNote = d.note;

    // Name: accept a cleaned-up name; refuse one that is clearly a different vendor.
    for (const r of d.rows) {
      const rn = str(r.cells["Name"]);
      if (!rn || rn === v.name) continue;
      const a = nameKey(rn);
      const b = nameKey(v.name);
      if (a === b || b.startsWith(a) || a.startsWith(b)) {
        if (v.name.startsWith(rn) && !v.email) {
          const tail = v.name.slice(rn.length).trim();
          if (/^[\w.+-]+@[\w.-]+$/.test(tail)) v.email = tail;
        }
        log(v, `Name "${v.name}" -> "${rn}"`, "Your name edit");
        v.name = rn;
        break;
      } else {
        open.push({ vendor: v.name, phone: formatPhone(v.phone), issue: `A name edit to "${rn}" looks like a different vendor; kept "${v.name}"`, yourNote: d.note });
      }
    }

    // Address added / completed during review.
    if (/address added|city and state/i.test(d.note)) {
      const ra = d.rows.map((r) => str(r.cells["Address"])).find((a) => a && !/^n\/a$/i.test(a) && !a.includes("@"));
      if (ra && ra !== v.address) {
        log(v, `Address "${oneLine(v.address)}" -> "${oneLine(ra)}"`, d.note);
        setLocation(v, ra);
        v.flags.push("address_added_in_review");
      }
    }

    // Phone added during review.
    if (/phone number added/i.test(d.note)) {
      const p = normalizePhone10(str(row.cells["Phone"]));
      if (p) {
        v.phone = p;
        v.flags = v.flags.filter((f) => f !== "no_phone");
        log(v, `Phone added: ${formatPhone(p)}`, d.note);
      }
    }

    // A secondary phone number filled in during review.
    const sp = normalizePhone10(str(row.cells["Secondary phone"]));
    if (sp && !v.secondaryPhone && sp !== v.phone) {
      v.secondaryPhone = sp;
      log(v, `Secondary phone added: ${formatPhone(sp)}`, "Your edit to the Secondary phone cell");
    }

    // Notes edited in review (e.g. reason for a DNC).
    const rn = oneLine(row.cells["Notes"]);
    if (rn !== oneLine(v.notes)) {
      log(v, `Notes "${oneLine(v.notes)}" -> "${rn}"`, "Your notes edit");
      v.notes = str(row.cells["Notes"]);
    }

    if (/^us vendor/i.test(d.note)) {
      v.flags = v.flags.filter((f) => f !== "address_is_us_but_notes_or_address_mention_canada");
      log(v, "Confirmed as a US vendor (Canada note cleared)", d.note);
    }
    if (/vendor not found/i.test(d.note)) {
      // handled below as an open question
    }
  }

  // ---- 4. removals and row-reference duplicates ----------------------------
  const noteOf = (v: VendorCandidate) => decisions.get(v)?.note ?? "";
  const refTo = (note: string) => {
    const m = /row\s+(\d+)/i.exec(note);
    return m ? rowToVendor.get(Number(m[1])) : undefined;
  };
  for (const [r, v] of matched) {
    const note = str(r.cells["Revision"]);
    if (/vendor in canada/i.test(note) && !removed.has(v)) {
      removed.add(v);
      v.flags.push("canadian_per_review");
      excludedCanadian.push(v);
      log(v, "Removed — vendor is in Canada", note);
    }
    if (r.sheet === "Needs review" && /(same as row|double entry)/i.test(note) && !removed.has(v)) {
      const keep = refTo(note);
      if (!keep || keep === v) {
        open.push({ vendor: v.name, phone: formatPhone(v.phone), issue: "Could not find the row this one duplicates", yourNote: oneLine(note) });
        continue;
      }
      mergeVendorInto(keep, v);
      removed.add(v);
      removedAsDuplicate.push(v);
      log(keep, `Merged duplicate entry "${v.name}" into this vendor`, note);
    }
    if (/vendor not found/i.test(note) && !removed.has(v)) {
      v.flags.push("vendor_not_found_in_review");
      open.push({
        vendor: v.name,
        phone: formatPhone(v.phone),
        issue: "Marked 'vendor not found' — kept with no location. Keep it, hold it, or remove it?",
        yourNote: oneLine(note),
      });
    }
  }

  // ---- 5. "same vendor" merges with a canonical info block -------------------
  const groups = new Map<string, { block: CanonicalBlock; vendors: VendorCandidate[]; note: string }>();
  for (const [r, v] of matched) {
    const note = str(r.cells["Revision"]);
    const block = parseCanonicalBlock(note);
    if (!block) continue;
    const key = digits(block.values["Phone"]) || nameKey(block.name);
    const g = groups.get(key) ?? { block, vendors: [], note: oneLine(note).slice(0, 80) };
    if (!g.vendors.includes(v)) g.vendors.push(v);
    groups.set(key, g);
  }
  for (const [, g] of groups) {
    const [keep, ...others] = g.vendors;
    for (const o of others) {
      mergeVendorInto(keep, o);
      removed.add(o);
      removedAsDuplicate.push(o);
    }
    const b = g.block.values;
    const beforeName = keep.name;
    keep.name = g.block.name || keep.name;
    const p = normalizePhone10(b["Phone"]);
    if (p) keep.phone = p;
    keep.flags = keep.flags.filter((f) => f !== "no_phone");
    if (b["Secondary Phone"]) keep.secondaryPhone = normalizePhone10(b["Secondary Phone"]);
    if (b["Email"]) keep.email = b["Email"];
    if (b["Contact Name"]) keep.contactName = b["Contact Name"];
    if (b["Services"]) setServices(keep, b["Services"]);
    if (b["Equipment"]) keep.equipment = splitList(b["Equipment"].replace(/,/g, "\n"));
    if (b["Status"]) {
      const t = tierFromStatus(b["Status"]);
      if (t) {
        keep.tier = t;
        keep.tierSource = "review";
      }
    }
    if (b["Complete Address"]) {
      const hadCoords = keep.lat !== null && keep.lng !== null;
      const lat = keep.lat;
      const lng = keep.lng;
      const q = keep.locationQuality;
      setLocation(keep, b["Complete Address"]);
      // Real coordinates from one of the duplicate pins beat a lookup.
      if (hadCoords && keep.locationQuality !== "latlong_in_address") {
        keep.lat = lat;
        keep.lng = lng;
        keep.locationQuality = q === "street_address" ? "latlong_in_address" : q;
      }
    }
    keep.flags = keep.flags.filter((f) => !RESOLVED_BY_REVIEW.includes(f));
    keep.reviewNote = g.note;
    log(keep, `Merged ${g.vendors.length} entries into one vendor${beforeName !== keep.name ? ` (named "${keep.name}")` : ""}, using the info you gave`, g.note);
  }

  // ---- 5b. a phone number added in review can reveal a duplicate entry ----------
  const live = vendors.filter((v) => !removed.has(v) && v.phone);
  const byPhone = new Map<string, VendorCandidate[]>();
  for (const v of live) byPhone.set(v.phone as string, [...(byPhone.get(v.phone as string) ?? []), v]);
  for (const [, group] of byPhone) {
    if (group.length < 2) continue;
    const [keep, ...rest] = group;
    for (const o of rest) {
      if (nameKey(o.name) === nameKey(keep.name) && addressesCompatible(o.address, keep.address)) {
        mergeVendorInto(keep, o);
        removed.add(o);
        removedAsDuplicate.push(o);
        log(keep, `Merged duplicate entry "${o.name}" (same phone, name, and address)`, "Phone number added in review");
      }
    }
  }

  // ---- 6. anything still unclassified stays held -----------------------------
  for (const v of vendors) {
    if (removed.has(v)) continue;
    if (v.tier === "unclassified") {
      open.push({ vendor: v.name, phone: formatPhone(v.phone), issue: "Still has no tier — will stay held out of recommendations until one is set", yourNote: noteOf(v) });
    }
  }

  const finalVendors = vendors.filter((v) => !removed.has(v));
  const tierCounts = new Map<string, number>();
  for (const v of finalVendors) tierCounts.set(v.tier, (tierCounts.get(v.tier) ?? 0) + 1);

  return {
    plan: {
      ...plan,
      vendors: finalVendors,
      excludedCanadian,
    },
    changes,
    open,
    removedAsDuplicate,
    stats: {
      revisionRowsRead: rows.length,
      rowsUnmatched: unmatched,
      changesLogged: changes.length,
      openItems: open.length,
      ...Object.fromEntries([...tierCounts.entries()].map(([k, n]) => [`tier_${k}`, n])),
    },
  };
}

export interface ReviewDecisions {
  removeVendors: { name: string; phone: string; reason: string }[];
  addAddresses: { name: string; address: string }[];
}

// Follow-up decisions made after the Revision-column pass (vendors confirmed
// as non-existent, addresses supplied for vendors that had none).
export function applyDecisions(
  result: RevisionResult,
  decisions: ReviewDecisions
): { result: RevisionResult; removedPerReview: VendorCandidate[] } {
  const vendors = [...result.plan.vendors];
  const changes = [...result.changes];
  const removedPerReview: VendorCandidate[] = [];

  for (const r of decisions.removeVendors) {
    const idx = vendors.findIndex((v) => v.phone === r.phone && nameKey(v.name) === nameKey(r.name));
    if (idx === -1) {
      changes.push({ vendor: r.name, phone: formatPhone(r.phone), change: "NOT FOUND in the list — nothing removed", basedOn: r.reason });
      continue;
    }
    const [v] = vendors.splice(idx, 1);
    v.flags.push("removed_per_review");
    removedPerReview.push(v);
    changes.push({ vendor: v.name, phone: formatPhone(v.phone), change: "Removed from the import", basedOn: r.reason });
  }

  for (const a of decisions.addAddresses) {
    const key = nameKey(a.name);
    const v = vendors.find(
      (x) => x.locationQuality === "none" && (nameKey(x.name) === key || nameKey(x.name).startsWith(key))
    );
    if (!v) {
      changes.push({ vendor: a.name, phone: "", change: "NOT FOUND among vendors without a location — address not added", basedOn: "Address supplied in review" });
      continue;
    }
    setLocation(v, a.address);
    v.flags = v.flags.filter((f) => f !== "email_found_in_address_field");
    v.flags.push("address_added_in_review");
    changes.push({ vendor: v.name, phone: formatPhone(v.phone), change: `Address added: ${a.address}`, basedOn: "Address supplied in review" });
  }

  const open = result.open.filter(
    (o) => !decisions.removeVendors.some((r) => nameKey(r.name) === nameKey(o.vendor)) && !/different vendor/.test(o.issue)
  );
  return { result: { ...result, plan: { ...result.plan, vendors }, changes, open }, removedPerReview };
}

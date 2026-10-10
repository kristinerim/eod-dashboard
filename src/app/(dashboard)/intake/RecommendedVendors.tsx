"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VENDOR_MAP_URL } from "@/lib/constants";
import { SERVICE_LABELS, TIER_LABELS, TIER_STYLES, formatPhoneDisplay, type VendorTier } from "@/lib/vendors";
import { formatDriveTime, needsTeamLeaderApproval } from "@/lib/vendorSearch";
import { STATUS_LABELS, type ContactStatus, type DropdownStatus } from "@/lib/vendorStatus";
import {
  findRecommendedVendors,
  getDriveTimes,
  type RecommendationResult,
  type RecommendedVendor,
} from "./vendor-search-actions";

// The minimum the form needs to know about a vendor to record a call.
export type VendorRef = { id: string; name: string; phone: string | null; tier: VendorTier };

// One vendor's record on this job: a Contacted Vendors row.
export type ContactedRef = {
  id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  phone_number: string | null;
  vendor_tier: string | null;
  status: ContactStatus;
  quote_amount: number | null;
  goa_amount: number | null;
  eta_given: string | null;
  notes: string | null;
  tl_approved_by: string | null;
};

export type RowPatch = Partial<Pick<ContactedRef, "quote_amount" | "goa_amount" | "eta_given" | "notes" | "tl_approved_by">>;

const INITIAL_COUNT = 5;
type Drive = { miles: number; minutes: number };

const num = (v: string): number | null => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));

// Recommended vendors for the customer's location and the requested service,
// shown automatically in Dispatch & Operations. Every vendor starts as Not
// Contacted. A vendor's quote, GOA, ETA and notes are edited right here and
// are saved as that vendor's own Contacted Vendors record.
export default function RecommendedVendors({
  snapshot,
  contacted,
  approvers,
  onStatus,
  onEdit,
}: {
  snapshot: Record<string, string>;
  contacted: ContactedRef[];
  approvers: string[];
  onStatus: (vendor: VendorRef, status: DropdownStatus) => void;
  onEdit: (rowId: string, patch: RowPatch) => void;
}) {
  const latStr = snapshot.service_latitude?.trim() ?? "";
  const lngStr = snapshot.service_longitude?.trim() ?? "";
  const lat = Number(latStr);
  const lng = Number(lngStr);
  const hasPin = latStr !== "" && lngStr !== "" && Number.isFinite(lat) && Number.isFinite(lng);
  const jobType = snapshot.job_type ?? "";
  const city = snapshot.service_city ?? "";
  const state = snapshot.state ?? "";

  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [driveByLoc, setDriveByLoc] = useState<Record<string, Record<string, Drive>>>({});
  const asked = useRef(new Set<string>());
  const request = useRef(0);

  // Find the vendors — from the vendors' saved coordinates only, no Google call.
  const locKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  useEffect(() => {
    if (!hasPin || !jobType) return;
    const mine = ++request.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      const r = await findRecommendedVendors({ latitude: lat, longitude: lng, jobType });
      if (mine !== request.current) return;
      setResult(r);
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [hasPin, lat, lng, jobType]);

  const recommended = useMemo(() => (result && "ok" in result ? result.recommended : []), [result]);
  const approval = useMemo(() => (result && "ok" in result ? result.needsApproval : []), [result]);
  const shown = useMemo(() => (expanded ? recommended : recommended.slice(0, INITIAL_COUNT)), [expanded, recommended]);
  const shownApproval = useMemo(() => (showApproval ? approval : []), [showApproval, approval]);

  // Exact drive times, only for the vendors on screen, once per location.
  const visibleIds = useMemo(() => [...shown, ...shownApproval].map((v) => v.id).join(","), [shown, shownApproval]);
  useEffect(() => {
    if (!hasPin || !visibleIds) return;
    const missing = visibleIds.split(",").filter((id) => !asked.current.has(`${locKey}|${id}`));
    if (missing.length === 0) return;
    missing.forEach((id) => asked.current.add(`${locKey}|${id}`));
    getDriveTimes({ latitude: lat, longitude: lng, vendorIds: missing }).then((times) => {
      if (Object.keys(times).length === 0) return;
      setDriveByLoc((prev) => ({ ...prev, [locKey]: { ...(prev[locKey] ?? {}), ...times } }));
    });
  }, [visibleIds, hasPin, locKey, lat, lng]);

  const drives = driveByLoc[locKey] ?? {};
  const rowFor = (id: string) => contacted.find((r) => r.vendor_id === id);
  const listedIds = new Set([...recommended, ...approval].map((v) => v.id));
  const earlier = contacted.filter((r) => r.vendor_id && !listedIds.has(r.vendor_id));
  const where = [city.trim(), state.trim()].filter(Boolean).join(", ") || (hasPin ? "Pinned location" : "—");

  const rowProps = { approvers, onStatus, onEdit, openId, setOpenId };

  return (
    <section className="space-y-2 rounded-lg border border-black/10 bg-black/[0.02] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-black/70">
            Recommended vendors{jobType ? ` – ${jobType}` : ""}
          </h3>
          {hasPin && jobType && <p className="text-xs text-black/50">Customer location: {where}</p>}
        </div>
        <div className="flex gap-3 text-xs">
          <a href={VENDOR_MAP_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Open Vendor Map ↗
          </a>
          <Link href="/vendors" target="_blank" className="underline underline-offset-2">
            Full vendor list ↗
          </Link>
        </div>
      </div>

      {!hasPin && (
        <p className="text-xs text-black/50">
          Enter the customer&apos;s service location (Service Location step) to see nearby vendors.
        </p>
      )}
      {hasPin && !jobType && <p className="text-xs text-black/50">Select the service type to see vendors that can do the job.</p>}
      {hasPin && jobType && result && "error" in result && <p className="text-sm text-red-600">{result.error}</p>}

      {hasPin && jobType && result && "ok" in result && (
        <div className={loading ? "opacity-60" : ""}>
          {recommended.length === 0 ? (
            <p className="text-sm text-black/60">
              No eligible vendors with a map location were found for this service nearby. Try the Vendor Map.
            </p>
          ) : (
            <Table>
              {shown.map((v) => (
                <Row key={v.id} vendor={v} drive={drives[v.id]} row={rowFor(v.id)} {...rowProps} />
              ))}
            </Table>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {recommended.length > INITIAL_COUNT && (
              <button type="button" onClick={() => setExpanded((e) => !e)} className="font-medium underline underline-offset-2">
                {expanded ? "Show fewer vendors" : `View more vendors (${recommended.length - INITIAL_COUNT})`}
              </button>
            )}
            {approval.length > 0 && (
              <button type="button" onClick={() => setShowApproval((s) => !s)} className="text-amber-800 underline underline-offset-2">
                {showApproval
                  ? "Hide vendors that need team leader approval"
                  : `${approval.length} nearby vendor${approval.length === 1 ? " needs" : "s need"} team leader approval`}
              </button>
            )}
            {loading && <span className="text-black/50">Updating…</span>}
          </div>

          {shownApproval.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Team leader approval required before assigning any job
              </p>
              <Table>
                {shownApproval.map((v) => (
                  <Row key={v.id} vendor={v} drive={drives[v.id]} row={rowFor(v.id)} warn {...rowProps} />
                ))}
              </Table>
            </div>
          )}
        </div>
      )}

      {earlier.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
            Contacted earlier (not in the current search)
          </p>
          <Table>
            {earlier.map((r) => (
              <EarlierRow key={r.id} row={r} {...rowProps} />
            ))}
          </Table>
        </div>
      )}
    </section>
  );
}

// Vendor | Classification | Distance | Phone | Status | Quote | GOA | ETA | Notes
const COLS =
  "grid grid-cols-[minmax(7rem,1.5fr)_5.2rem_4rem_6.4rem_6rem_4.6rem_4.4rem_4.6rem_minmax(6rem,1.4fr)] items-center gap-x-1.5";

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-black/10 bg-white text-sm">
      <div className="min-w-[58rem]">
        <div className={`${COLS} border-b border-black/10 bg-black/5 px-2 py-1 text-[11px] font-medium text-black/60`}>
          <span>Vendor</span>
          <span>Classification</span>
          <span>Distance</span>
          <span>Phone</span>
          <span>Status</span>
          <span>Quote</span>
          <span>GOA</span>
          <span>ETA</span>
          <span>Notes</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function ClassBadge({ tier }: { tier: VendorTier }) {
  return (
    <span className={`inline-block max-w-full truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium ${TIER_STYLES[tier]}`}>
      {TIER_LABELS[tier]}
    </span>
  );
}

const cell = "w-full rounded border border-black/20 px-1 py-0.5 text-xs disabled:bg-black/5 disabled:text-black/30";

function Fields({
  vendor,
  row,
  onStatus,
  onEdit,
}: {
  vendor: VendorRef;
  row: ContactedRef | undefined;
  onStatus: (v: VendorRef, s: DropdownStatus) => void;
  onEdit: (rowId: string, patch: RowPatch) => void;
}) {
  const status: DropdownStatus = row?.status ?? "not_contacted";
  const off = !row;
  return (
    <>
      <select
        aria-label={`Status for ${vendor.name}`}
        value={status}
        onChange={(e) => onStatus(vendor, e.target.value as DropdownStatus)}
        className={`${cell} font-medium ${status === "go" ? "bg-green-100" : status === "no_go" ? "bg-red-50" : ""}`}
      >
        {(Object.keys(STATUS_LABELS) as DropdownStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <input
        type="number"
        step="0.01"
        min="0"
        aria-label={`Quote from ${vendor.name}`}
        placeholder={off ? "—" : "$"}
        disabled={off}
        value={row?.quote_amount ?? ""}
        onChange={(e) => row && onEdit(row.id, { quote_amount: num(e.target.value) })}
        className={cell}
      />
      <input
        type="number"
        step="0.01"
        min="0"
        aria-label={`GOA amount for ${vendor.name}`}
        placeholder={off ? "—" : "$"}
        disabled={off}
        value={row?.goa_amount ?? ""}
        onChange={(e) => row && onEdit(row.id, { goa_amount: num(e.target.value) })}
        className={cell}
      />
      <input
        aria-label={`ETA from ${vendor.name}`}
        placeholder={off ? "—" : "30 min"}
        disabled={off}
        value={row?.eta_given ?? ""}
        onChange={(e) => row && onEdit(row.id, { eta_given: e.target.value })}
        className={cell}
      />
      <input
        aria-label={`Notes on ${vendor.name}`}
        placeholder={off ? "—" : "Notes"}
        disabled={off}
        value={row?.notes ?? ""}
        onChange={(e) => row && onEdit(row.id, { notes: e.target.value })}
        className={cell}
      />
    </>
  );
}

function ApprovalLine({
  row,
  approvers,
  onEdit,
}: {
  row: ContactedRef;
  approvers: string[];
  onEdit: (rowId: string, patch: RowPatch) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-amber-200 bg-amber-50 px-3 py-1.5 text-xs">
      <span className="font-medium text-amber-800">Team leader approval required:</span>
      <select
        value={row.tl_approved_by ?? ""}
        onChange={(e) => onEdit(row.id, { tl_approved_by: e.target.value || null })}
        className="rounded border border-black/20 px-1.5 py-0.5"
      >
        <option value="">Select who approved…</option>
        {approvers.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}

type RowShared = {
  approvers: string[];
  onStatus: (v: VendorRef, s: DropdownStatus) => void;
  onEdit: (rowId: string, patch: RowPatch) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

function rowTone(row: ContactedRef | undefined, warn?: boolean) {
  if (row?.status === "go") return "bg-green-50";
  if (row?.status === "no_go") return "bg-black/[0.03] text-black/60";
  return warn ? "bg-amber-50" : "";
}

function Row({
  vendor: v,
  drive,
  row,
  warn,
  approvers,
  onStatus,
  onEdit,
  openId,
  setOpenId,
}: RowShared & { vendor: RecommendedVendor; drive: Drive | undefined; row: ContactedRef | undefined; warn?: boolean }) {
  const open = openId === v.id;
  const miles = drive ? drive.miles : v.straightMiles;
  const minutes = drive ? drive.minutes : v.estimatedMinutes;
  const tilde = drive ? "" : "~";
  return (
    <div className={`border-b border-black/5 last:border-b-0 ${rowTone(row, warn)}`}>
      <div className={`${COLS} px-2 py-1.5`}>
        <button
          type="button"
          onClick={() => setOpenId(open ? null : v.id)}
          aria-expanded={open}
          className="min-w-0 truncate text-left font-medium hover:underline"
        >
          <span className="mr-1 text-black/40">{open ? "▾" : "▸"}</span>
          {v.name}
        </button>
        <span>
          <ClassBadge tier={v.tier} />
        </span>
        <span className="text-xs leading-tight">
          <span className="font-medium">
            {tilde}
            {miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi
          </span>
          <span className="block text-black/50">
            {tilde}
            {formatDriveTime(minutes)}
          </span>
        </span>
        <span className="text-xs">
          {v.phone ? (
            <a href={`tel:${v.phone}`} className="hover:underline">
              {formatPhoneDisplay(v.phone)}
            </a>
          ) : (
            <span className="text-black/40">No phone</span>
          )}
        </span>
        <Fields vendor={v} row={row} onStatus={onStatus} onEdit={onEdit} />
      </div>
      {row && needsTeamLeaderApproval(v.tier) && <ApprovalLine row={row} approvers={approvers} onEdit={onEdit} />}
      {open && (
        <div className="space-y-1.5 border-t border-black/5 bg-black/[0.02] px-3 py-2 text-xs">
          <div className="text-black/70">
            {v.address && !/^-?\d+\.\d+[,\s]+-?\d+\.\d+$/.test(v.address.trim()) ? v.address : "No street address on file"}
            {v.contactName && !/^(n\/?a|none|-+)$/i.test(v.contactName.trim()) ? ` · Contact: ${v.contactName}` : ""}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {v.servicesListed ? (
              v.services.slice(0, 6).map((s) => (
                <span key={s} className="rounded bg-black/5 px-1.5 py-0.5 text-black/60">
                  {SERVICE_LABELS[s]}
                </span>
              ))
            ) : (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">Services not listed — confirm on the call</span>
            )}
            {v.heavyDutyOnly && <span className="rounded bg-black/10 px-1.5 py-0.5">Heavy-duty only</span>}
            {v.approximateLocation && <span className="rounded bg-black/10 px-1.5 py-0.5">Approximate location (city only)</span>}
            {!drive && <span className="rounded bg-black/10 px-1.5 py-0.5">Distance and time are estimates until loaded</span>}
          </div>
          {needsTeamLeaderApproval(v.tier) && (
            <p className="font-medium text-amber-800">
              Get a team leader&apos;s approval before assigning any job to this vendor.
            </p>
          )}
          <Link href={`/vendors/${v.id}`} target="_blank" className="underline underline-offset-2">
            View vendor profile ↗
          </Link>
        </div>
      )}
    </div>
  );
}

function EarlierRow({ row, approvers, onStatus, onEdit }: RowShared & { row: ContactedRef }) {
  const vendor: VendorRef = {
    id: row.vendor_id!,
    name: row.vendor_name ?? "Vendor",
    phone: row.phone_number,
    tier: (row.vendor_tier as VendorTier) ?? "non_preferred",
  };
  return (
    <div className={`border-b border-black/5 last:border-b-0 ${rowTone(row)}`}>
      <div className={`${COLS} px-2 py-1.5`}>
        <Link href={`/vendors/${row.vendor_id}`} target="_blank" className="min-w-0 truncate font-medium hover:underline">
          {vendor.name}
        </Link>
        <span>{row.vendor_tier ? <ClassBadge tier={vendor.tier} /> : null}</span>
        <span className="text-xs text-black/40">—</span>
        <span className="text-xs">{row.phone_number ?? ""}</span>
        <Fields vendor={vendor} row={row} onStatus={onStatus} onEdit={onEdit} />
      </div>
      {needsTeamLeaderApproval(row.vendor_tier) && <ApprovalLine row={row} approvers={approvers} onEdit={onEdit} />}
    </div>
  );
}

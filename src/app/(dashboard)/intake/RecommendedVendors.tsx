"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VENDOR_MAP_URL } from "@/lib/constants";
import { SERVICE_LABELS, formatPhoneDisplay, type VendorTier } from "@/lib/vendors";
import { formatDriveTime, needsTeamLeaderApproval } from "@/lib/vendorSearch";
import { TierBadge } from "../vendors/TierBadge";
import { setFieldValue } from "./useFormSnapshot";
import {
  findRecommendedVendors,
  geocodeServiceAddress,
  getDriveTimes,
  type RecommendationResult,
  type RecommendedVendor,
} from "./vendor-search-actions";

// The minimum the form needs to know about a vendor to record a call.
export type VendorRef = { id: string; name: string; phone: string | null; tier: VendorTier };

// A Contacted Vendors row, as far as this section cares.
export type ContactedRef = {
  vendor_id: string | null;
  vendor_name: string | null;
  phone_number: string | null;
  vendor_tier: string | null;
  is_assigned: boolean;
};

const INITIAL_COUNT = 3;
type Drive = { miles: number; minutes: number };

// Recommended vendors for the customer's location and the requested service,
// shown automatically as soon as both are known. Nothing is ever marked
// Called or Assigned for the agent: those boxes only reflect what the agent
// has recorded in Contacted Vendors.
export default function RecommendedVendors({
  snapshot,
  formRef,
  mode,
  contacted = [],
  onCalled,
  onAssigned,
}: {
  snapshot: Record<string, string>;
  formRef: React.RefObject<HTMLFormElement | null>;
  mode: "lead" | "job";
  contacted?: ContactedRef[];
  onCalled?: (vendor: VendorRef, checked: boolean) => void;
  onAssigned?: (vendor: VendorRef, checked: boolean) => void;
}) {
  const latStr = snapshot.service_latitude?.trim() ?? "";
  const lngStr = snapshot.service_longitude?.trim() ?? "";
  const lat = Number(latStr);
  const lng = Number(lngStr);
  const hasPin = latStr !== "" && lngStr !== "" && Number.isFinite(lat) && Number.isFinite(lng);
  const jobType = snapshot.job_type ?? "";
  const street = snapshot.service_street_address ?? "";
  const city = snapshot.service_city ?? "";
  const state = snapshot.state ?? "";
  const zip = snapshot.service_zip ?? "";
  const addressSig = [street, city, state, zip].map((s) => s.trim().toLowerCase()).join("|");

  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showApproval, setShowApproval] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [driveByLoc, setDriveByLoc] = useState<Record<string, Record<string, Drive>>>({});
  const asked = useRef(new Set<string>());
  const request = useRef(0);
  const prev = useRef({ addressSig, latStr, lngStr });

  // -- Pin the location -------------------------------------------------------
  // Address search pins it. If the agent typed the address instead (or changed
  // it after pinning), look the coordinates up so the list still follows them.
  useEffect(() => {
    const before = prev.current;
    prev.current = { addressSig, latStr, lngStr };
    const addressChanged = before.addressSig !== addressSig;
    const coordsChanged = before.latStr !== latStr || before.lngStr !== lngStr;
    const usable = (city.trim() && state.trim()) || zip.trim();

    if (addressChanged && !coordsChanged && hasPin && !addressSig.replace(/\|/g, "")) {
      // The address was cleared: forget the old pin.
      setFieldValue(formRef.current, "service_latitude", "");
      setFieldValue(formRef.current, "service_longitude", "");
      return;
    }
    const stale = hasPin && addressChanged && !coordsChanged;
    if ((hasPin && !stale) || !usable) return;

    const text = [street, city, state, zip].map((s) => s.trim()).filter(Boolean).join(", ");
    const timer = setTimeout(async () => {
      setLocating("Locating the address…");
      const r = await geocodeServiceAddress(text);
      if ("error" in r) {
        setLocating("Couldn't place that address — check it, or use the address search.");
        return;
      }
      setLocating(null);
      setFieldValue(formRef.current, "service_latitude", String(r.latitude));
      setFieldValue(formRef.current, "service_longitude", String(r.longitude));
    }, 1200);
    return () => clearTimeout(timer);
  }, [addressSig, latStr, lngStr, hasPin, street, city, state, zip, formRef]);

  // -- Find the vendors -------------------------------------------------------
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

  // -- Exact drive times, only for the vendors on screen ---------------------
  const visibleIds = useMemo(
    () => [...shown, ...shownApproval].map((v) => v.id).join(","),
    [shown, shownApproval]
  );
  useEffect(() => {
    if (!hasPin || !visibleIds) return;
    // Each vendor is asked about once per location, however often the list re-renders.
    const missing = visibleIds.split(",").filter((id) => !asked.current.has(`${locKey}|${id}`));
    if (missing.length === 0) return;
    missing.forEach((id) => asked.current.add(`${locKey}|${id}`));
    getDriveTimes({ latitude: lat, longitude: lng, vendorIds: missing }).then((times) => {
      if (Object.keys(times).length === 0) return;
      setDriveByLoc((prev) => ({ ...prev, [locKey]: { ...(prev[locKey] ?? {}), ...times } }));
    });
  }, [visibleIds, hasPin, locKey, lat, lng]);

  const drives = driveByLoc[locKey] ?? {};
  const calledRow = (id: string) => contacted.find((r) => r.vendor_id === id);
  const listedIds = new Set([...recommended, ...approval].map((v) => v.id));
  const earlier = contacted.filter((r) => r.vendor_id && !listedIds.has(r.vendor_id));

  const where = [city.trim(), state.trim()].filter(Boolean).join(", ") || (hasPin ? "Pinned location" : "—");

  return (
    <section className="rounded-lg border border-black/10 bg-black/[0.02] p-3">
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

      {locating && <p className="mt-2 text-xs text-black/50">{locating}</p>}
      {!hasPin && !locating && (
        <p className="mt-2 text-xs text-black/50">
          Enter the service location to see nearby vendors (use <span className="font-medium">Search address</span> on
          the Service Location step).
        </p>
      )}
      {hasPin && !jobType && (
        <p className="mt-2 text-xs text-black/50">Select the service type to see vendors that can do the job.</p>
      )}
      {mode === "lead" && hasPin && jobType && (
        <p className="mt-2 text-xs text-black/50">
          Called and Assigned unlock once this lead is converted to a job.
        </p>
      )}

      {hasPin && jobType && result && "error" in result && <p className="mt-2 text-sm text-red-600">{result.error}</p>}

      {hasPin && jobType && result && "ok" in result && (
        <div className={`mt-2 ${loading ? "opacity-60" : ""}`}>
          {recommended.length === 0 ? (
            <p className="text-sm text-black/60">
              No eligible vendors with a map location were found for this service nearby. Try the Vendor Map.
            </p>
          ) : (
            <Table>
              {shown.map((v) => (
                <Row
                  key={v.id}
                  vendor={v}
                  drive={drives[v.id]}
                  open={openId === v.id}
                  onOpen={() => setOpenId(openId === v.id ? null : v.id)}
                  mode={mode}
                  called={calledRow(v.id)}
                  onCalled={onCalled}
                  onAssigned={onAssigned}
                />
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
              <button
                type="button"
                onClick={() => setShowApproval((s) => !s)}
                className="text-amber-800 underline underline-offset-2"
              >
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
                  <Row
                    key={v.id}
                    vendor={v}
                    drive={drives[v.id]}
                    open={openId === v.id}
                    onOpen={() => setOpenId(openId === v.id ? null : v.id)}
                    mode={mode}
                    called={calledRow(v.id)}
                    onCalled={onCalled}
                    onAssigned={onAssigned}
                    warn
                  />
                ))}
              </Table>
            </div>
          )}
        </div>
      )}

      {earlier.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-black/50">
            Contacted earlier (not in the current search)
          </p>
          <Table>
            {earlier.map((r) => (
              <EarlierRow key={r.vendor_id} row={r} onCalled={onCalled} onAssigned={onAssigned} />
            ))}
          </Table>
        </div>
      )}
    </section>
  );
}

const COLS = "grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_3.2rem_4.2rem] items-center gap-x-2";

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded border border-black/10 bg-white text-sm">
      <div className={`${COLS} border-b border-black/10 bg-black/5 px-2 py-1 text-[11px] font-medium text-black/60`}>
        <span>Vendor</span>
        <span>Classification</span>
        <span>Distance</span>
        <span>Phone</span>
        <span className="text-center">Called</span>
        <span className="text-center">Assigned</span>
      </div>
      {children}
    </div>
  );
}

function Checks({
  vendor,
  mode,
  called,
  onCalled,
  onAssigned,
}: {
  vendor: VendorRef;
  mode: "lead" | "job";
  called: ContactedRef | undefined;
  onCalled?: (v: VendorRef, checked: boolean) => void;
  onAssigned?: (v: VendorRef, checked: boolean) => void;
}) {
  const disabled = mode === "lead" || !onCalled;
  const title = disabled ? "Available once this lead is converted to a job" : undefined;
  return (
    <>
      <span className="text-center">
        <input
          type="checkbox"
          aria-label={`Called ${vendor.name}`}
          checked={Boolean(called)}
          disabled={disabled}
          title={title}
          onChange={(e) => onCalled?.(vendor, e.target.checked)}
        />
      </span>
      <span className="text-center">
        <input
          type="checkbox"
          aria-label={`Assigned ${vendor.name}`}
          checked={Boolean(called?.is_assigned)}
          disabled={disabled || !onAssigned}
          title={title}
          onChange={(e) => onAssigned?.(vendor, e.target.checked)}
        />
      </span>
    </>
  );
}

function Row({
  vendor: v,
  drive,
  open,
  onOpen,
  mode,
  called,
  onCalled,
  onAssigned,
  warn,
}: {
  vendor: RecommendedVendor;
  drive: Drive | undefined;
  open: boolean;
  onOpen: () => void;
  mode: "lead" | "job";
  called: ContactedRef | undefined;
  onCalled?: (v: VendorRef, checked: boolean) => void;
  onAssigned?: (v: VendorRef, checked: boolean) => void;
  warn?: boolean;
}) {
  const miles = drive ? drive.miles : v.straightMiles;
  const minutes = drive ? drive.minutes : v.estimatedMinutes;
  const tilde = drive ? "" : "~";
  return (
    <div className={`border-b border-black/5 last:border-b-0 ${warn ? "bg-amber-50" : ""}`}>
      <div className={`${COLS} px-2 py-1.5`}>
        <button type="button" onClick={onOpen} aria-expanded={open} className="min-w-0 truncate text-left font-medium hover:underline">
          <span className="mr-1 text-black/40">{open ? "▾" : "▸"}</span>
          {v.name}
        </button>
        <span>
          <TierBadge tier={v.tier} />
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
        <Checks vendor={v} mode={mode} called={called} onCalled={onCalled} onAssigned={onAssigned} />
      </div>
      {open && (
        <div className="space-y-1.5 border-t border-black/5 bg-black/[0.02] px-3 py-2 text-xs">
          <div className="text-black/70">
            {v.address ?? "No address on file"}
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
            {v.approximateLocation && (
              <span className="rounded bg-black/10 px-1.5 py-0.5">Approximate location (city only)</span>
            )}
            {!drive && <span className="rounded bg-black/10 px-1.5 py-0.5">Distance and time are estimates until loaded</span>}
          </div>
          {needsTeamLeaderApproval(v.tier) && (
            <p className="font-medium text-amber-800">
              Get a team leader&apos;s approval before assigning any job to this vendor
              {called ? " — select who approved in Contacted Vendors." : "."}
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

function EarlierRow({
  row,
  onCalled,
  onAssigned,
}: {
  row: ContactedRef;
  onCalled?: (v: VendorRef, checked: boolean) => void;
  onAssigned?: (v: VendorRef, checked: boolean) => void;
}) {
  const vendor: VendorRef = {
    id: row.vendor_id!,
    name: row.vendor_name ?? "Vendor",
    phone: row.phone_number,
    tier: (row.vendor_tier as VendorTier) ?? "non_preferred",
  };
  return (
    <div className={`${COLS} border-b border-black/5 px-2 py-1.5 last:border-b-0`}>
      <Link href={`/vendors/${row.vendor_id}`} target="_blank" className="min-w-0 truncate font-medium hover:underline">
        {vendor.name}
      </Link>
      <span>{row.vendor_tier ? <TierBadge tier={vendor.tier} /> : null}</span>
      <span className="text-xs text-black/40">—</span>
      <span className="text-xs">{row.phone_number ?? ""}</span>
      <Checks vendor={vendor} mode="job" called={row} onCalled={onCalled} onAssigned={onAssigned} />
    </div>
  );
}

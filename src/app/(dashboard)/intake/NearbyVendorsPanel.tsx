"use client";

import { useState, useTransition } from "react";
import { SERVICE_LABELS, formatPhoneDisplay } from "@/lib/vendors";
import { formatDriveTime, needsTeamLeaderApproval } from "@/lib/vendorSearch";
import { TierBadge } from "../vendors/TierBadge";
import { findNearbyVendors, type NearbyResult, type NearbyVendor } from "./vendor-search-actions";

// Nearby vendors for the pinned service location and requested job type.
// Searching is a deliberate click (not on every keystroke), and the results
// say plainly which vendors need a team leader's approval.
export default function NearbyVendorsPanel({
  snapshot,
  onAdd,
  addedIds,
}: {
  snapshot: Record<string, string>;
  // Present on jobs only: adds the vendor to Contacted Vendors.
  onAdd?: (vendor: NearbyVendor) => void;
  addedIds?: string[];
}) {
  const [result, setResult] = useState<NearbyResult | null>(null);
  const [searchedKey, setSearchedKey] = useState("");
  const [isPending, startTransition] = useTransition();

  const lat = Number(snapshot.service_latitude);
  const lng = Number(snapshot.service_longitude);
  const hasPin = snapshot.service_latitude?.trim() !== "" && snapshot.service_longitude?.trim() !== "" && Number.isFinite(lat) && Number.isFinite(lng);
  const jobType = snapshot.job_type ?? "";
  const key = `${lat}|${lng}|${jobType}`;
  const stale = result !== null && searchedKey !== key;

  function search() {
    const requested = key;
    startTransition(async () => {
      const r = await findNearbyVendors({ latitude: lat, longitude: lng, jobType });
      setResult(r);
      setSearchedKey(requested);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-black/10 bg-black/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Nearby vendors</h4>
          <p className="text-xs text-black/50">
            {jobType ? `Matched to “${jobType}”.` : "Pick the service type for a better match."} DNC Tier 3 vendors are never shown.
          </p>
        </div>
        <button
          type="button"
          onClick={search}
          disabled={!hasPin || isPending}
          className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {isPending ? "Searching…" : result ? "Search again" : "Find nearby vendors"}
        </button>
      </div>

      {!hasPin && <p className="text-xs text-black/50">Search the address above to pin the location first.</p>}
      {stale && !isPending && (
        <p className="text-xs text-amber-700">The location or service changed — search again to refresh.</p>
      )}

      {result && "error" in result && <p className="text-sm text-red-600">{result.error}</p>}

      {result && "ok" in result && (
        <div className="space-y-3">
          <p className="text-xs text-black/50">
            Showing the closest vendors within {result.radiusMiles} miles
            {result.serviceLabel ? ` for ${result.serviceLabel.toLowerCase()} work` : ""}.
          </p>
          <Group title="Preferred" vendors={result.preferred} onAdd={onAdd} addedIds={addedIds} />
          <Group title="Non Preferred" vendors={result.nonPreferred} onAdd={onAdd} addedIds={addedIds} />
          <Group
            title="Team leader approval required"
            vendors={result.needsApproval}
            onAdd={onAdd}
            addedIds={addedIds}
            warn
          />
          {result.preferred.length + result.nonPreferred.length + result.needsApproval.length === 0 && (
            <p className="text-sm text-black/60">
              No matching vendors with a map location were found nearby. Try the full vendor list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  vendors,
  onAdd,
  addedIds,
  warn,
}: {
  title: string;
  vendors: NearbyVendor[];
  onAdd?: (vendor: NearbyVendor) => void;
  addedIds?: string[];
  warn?: boolean;
}) {
  if (vendors.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${warn ? "text-amber-700" : "text-black/50"}`}>
        {title}
      </div>
      <ul className="space-y-1.5">
        {vendors.map((v) => (
          <VendorCard key={v.id} vendor={v} onAdd={onAdd} added={addedIds?.includes(v.id) ?? false} />
        ))}
      </ul>
    </div>
  );
}

function VendorCard({ vendor: v, onAdd, added }: { vendor: NearbyVendor; onAdd?: (v: NearbyVendor) => void; added: boolean }) {
  const approval = needsTeamLeaderApproval(v.tier);
  return (
    <li className={`rounded border p-2.5 text-sm ${approval ? "border-amber-300 bg-amber-50" : "border-black/10 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/vendors/${v.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline-offset-2 hover:underline"
            >
              {v.name}
            </a>
            <TierBadge tier={v.tier} />
          </div>
          <div className="mt-0.5 text-xs text-black/60">
            {v.phone ? (
              <a href={`tel:${v.phone}`} className="font-medium text-black/80 hover:underline">
                {formatPhoneDisplay(v.phone)}
              </a>
            ) : (
              "No phone on file"
            )}
            {v.contactName && !/^(n\/?a|none|-+)$/i.test(v.contactName.trim()) ? ` · ${v.contactName}` : ""}
            {v.address && !/^-?\d+\.\d+[,\s]+-?\d+\.\d+$/.test(v.address.trim()) ? ` · ${v.address}` : ""}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="font-semibold text-black/80">
            {v.exactDriveTime ? "" : "~"}
            {formatDriveTime(v.driveMinutes)} drive
          </div>
          <div className="text-black/50">
            {v.exactDriveTime ? "" : "~"}
            {Math.round(v.driveMiles)} mi{v.exactDriveTime ? "" : " (estimated)"}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {v.servicesListed ? (
          v.services.slice(0, 5).map((s) => (
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
      </div>

      {approval && (
        <p className="mt-1.5 text-xs font-medium text-amber-800">
          Get a team leader&apos;s approval before assigning any job to this vendor.
        </p>
      )}

      {onAdd && (
        <div className="mt-2">
          <button
            type="button"
            disabled={added}
            onClick={() => onAdd(v)}
            className="rounded border border-black/20 px-2.5 py-1 text-xs font-medium disabled:border-green-300 disabled:bg-green-50 disabled:text-green-800"
          >
            {added ? "✓ Added to Contacted Vendors" : "+ Add to Contacted Vendors"}
          </button>
        </div>
      )}
    </li>
  );
}

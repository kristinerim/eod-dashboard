"use client";

import { useEffect, useRef, useState } from "react";
import { setFieldValue } from "./useFormSnapshot";
import { calculateTripDistance } from "./distance-actions";
import { geocodeServiceAddress } from "./vendor-search-actions";

type Snapshot = Record<string, string>;
type FormRef = React.RefObject<HTMLFormElement | null>;

const t = (v: string | undefined) => (v ?? "").trim();

// Keeps the service location's map coordinates in step with its address.
// Address search pins it directly; if the agent types the address instead (or
// edits it after pinning), the coordinates are looked up here so everything
// that relies on them (recommended vendors) follows the address.
export function ServiceLocationPin({ snapshot, formRef }: { snapshot: Snapshot; formRef: FormRef }) {
  const street = t(snapshot.service_street_address);
  const city = t(snapshot.service_city);
  const state = t(snapshot.state);
  const zip = t(snapshot.service_zip);
  const latStr = t(snapshot.service_latitude);
  const lngStr = t(snapshot.service_longitude);
  const addressSig = [street, city, state, zip].map((s) => s.toLowerCase()).join("|");
  const hasPin = latStr !== "" && lngStr !== "" && Number.isFinite(Number(latStr)) && Number.isFinite(Number(lngStr));

  const [message, setMessage] = useState<string | null>(null);
  const prev = useRef({ addressSig, latStr, lngStr });

  useEffect(() => {
    const before = prev.current;
    prev.current = { addressSig, latStr, lngStr };
    const addressChanged = before.addressSig !== addressSig;
    const coordsChanged = before.latStr !== latStr || before.lngStr !== lngStr;
    const usable = (city && state) || zip;

    if (addressChanged && !coordsChanged && hasPin && !addressSig.replace(/\|/g, "")) {
      // The address was cleared: forget the old pin.
      setFieldValue(formRef.current, "service_latitude", "");
      setFieldValue(formRef.current, "service_longitude", "");
      return;
    }
    // Pinned already and the address hasn't been touched since: nothing to do.
    const stale = hasPin && addressChanged && !coordsChanged;
    if ((hasPin && !stale) || !usable) return;

    const text = [street, city, state, zip].filter(Boolean).join(", ");
    const timer = setTimeout(async () => {
      setMessage("Locating the address…");
      const r = await geocodeServiceAddress(text);
      if ("error" in r) {
        setMessage("Couldn't place that address — check it, or use the address search.");
        return;
      }
      setMessage(null);
      setFieldValue(formRef.current, "service_latitude", String(r.latitude));
      setFieldValue(formRef.current, "service_longitude", String(r.longitude));
    }, 1200);
    return () => clearTimeout(timer);
  }, [addressSig, latStr, lngStr, hasPin, street, city, state, zip, formRef]);

  return message ? <p className="text-xs text-black/50">{message}</p> : null;
}

type Place = { latitude: number; longitude: number } | { address: string };

// Works out the driving distance from the pickup to the drop-off whenever
// both are entered, and puts it in the Distance field. Typing in that field
// is respected until either address changes again.
export function TripDistance({ snapshot, formRef }: { snapshot: Snapshot; formRef: FormRef }) {
  const pickupAddress = [snapshot.service_street_address, snapshot.service_city, snapshot.state, snapshot.service_zip]
    .map(t)
    .filter(Boolean)
    .join(", ");
  const pickupUsable =
    (t(snapshot.service_street_address) && (t(snapshot.service_city) || t(snapshot.service_zip))) ||
    (t(snapshot.service_city) && t(snapshot.state));
  const lat = Number(t(snapshot.service_latitude));
  const lng = Number(t(snapshot.service_longitude));
  const hasPin = t(snapshot.service_latitude) !== "" && t(snapshot.service_longitude) !== "" && Number.isFinite(lat) && Number.isFinite(lng);

  const dropAddress = [
    snapshot.dropoff_street_address,
    snapshot.dropoff_city,
    snapshot.dropoff_state,
    snapshot.dropoff_zip,
  ]
    .map(t)
    .filter(Boolean)
    .join(", ");
  const dropUsable =
    (t(snapshot.dropoff_street_address) && (t(snapshot.dropoff_city) || t(snapshot.dropoff_zip))) ||
    (t(snapshot.dropoff_city) && t(snapshot.dropoff_state));

  // Prefer the typed address for the pickup so pinning it afterwards doesn't
  // look like a change; fall back to the map pin if there's no usable address.
  const pickup: Place | null = pickupUsable
    ? { address: pickupAddress }
    : hasPin
      ? { latitude: lat, longitude: lng }
      : null;
  const ready = Boolean(pickup && dropUsable);
  const sig = ready ? `${"address" in pickup! ? pickup.address.toLowerCase() : `${lat},${lng}`}>${dropAddress.toLowerCase()}` : "";
  const currentDistance = t(snapshot.distance_miles);

  const [status, setStatus] = useState<string | null>(null);
  const lastSig = useRef<string | null>(null);
  const manual = useRef(false);
  const setting = useRef(false);

  // Typing in the Distance field is a manual edit (the app's own writes are not).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    function onInput(e: Event) {
      if ((e.target as HTMLInputElement | null)?.name === "distance_miles" && !setting.current) manual.current = true;
    }
    form.addEventListener("input", onInput);
    return () => form.removeEventListener("input", onInput);
  }, [formRef]);

  useEffect(() => {
    if (!ready) return;
    if (lastSig.current === sig) return;
    // A saved job reopened with its distance already filled in: leave it alone.
    if (lastSig.current === null && currentDistance !== "") {
      lastSig.current = sig;
      return;
    }
    manual.current = false; // the addresses changed, so recalculate
    const timer = setTimeout(async () => {
      setStatus("Calculating the driving distance…");
      const r = await calculateTripDistance({ pickup: pickup!, dropoff: { address: dropAddress } });
      if ("error" in r) {
        setStatus(`${r.error} Enter the distance by hand.`);
        return;
      }
      lastSig.current = sig;
      if (manual.current) {
        setStatus(null);
        return;
      }
      setting.current = true;
      setFieldValue(formRef.current, "distance_miles", String(r.miles));
      setting.current = false;
      setStatus(`Driving distance calculated: ${r.miles} mi. You can edit it.`);
    }, 900);
    return () => clearTimeout(timer);
    // `pickup`/`dropAddress` are derived from `sig`; currentDistance only matters on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ready]);

  return status ? <p className="text-xs text-black/50">{status}</p> : null;
}

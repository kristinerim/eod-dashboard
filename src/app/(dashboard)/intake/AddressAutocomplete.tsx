"use client";

import { useEffect, useRef, useState } from "react";
import { parsePlaceAddress, type PlaceComponent } from "@/lib/places";
import { setFieldValue } from "./useFormSnapshot";

// Names of the form fields a picked address fills in. lat/lng are optional
// because only the service location stores coordinates.
export type AddressFieldNames = {
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat?: string;
  lng?: string;
};

type Suggestion = { placeId: string; main: string; secondary: string };

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;

function newToken() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
}

// Search-as-you-type address box backed by Google Places (New). The browser
// key is restricted to this site's domains, so calling the REST API straight
// from the page is safe. A session token groups the typing and the final pick
// into a single billable session.
export default function AddressAutocomplete({
  formRef,
  fields,
  label = "Search address",
}: {
  formRef: React.RefObject<HTMLFormElement | null>;
  fields: AddressFieldNames;
  label?: string;
}) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const token = useRef(newToken());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (!KEY) {
    return (
      <p className="rounded border border-dashed border-black/20 px-2 py-2 text-xs text-black/40">
        Address search isn&apos;t connected yet — type the address below.
      </p>
    );
  }

  function search(value: string) {
    setText(value);
    setMessage(null);
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const mine = ++latest.current;
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY! },
          body: JSON.stringify({
            input: value,
            sessionToken: token.current,
            includedRegionCodes: ["us", "ca"],
          }),
        });
        const body = await res.json();
        if (mine !== latest.current) return; // a newer search is already running
        if (!res.ok) {
          setSuggestions([]);
          setMessage("Address search is unavailable right now — type the address below.");
          return;
        }
        const list: Suggestion[] = (body.suggestions ?? [])
          .filter((s: { placePrediction?: unknown }) => s.placePrediction)
          .map(
            (s: {
              placePrediction: {
                placeId: string;
                text?: { text?: string };
                structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
              };
            }) => ({
              placeId: s.placePrediction.placeId,
              main: s.placePrediction.structuredFormat?.mainText?.text ?? s.placePrediction.text?.text ?? "",
              secondary: s.placePrediction.structuredFormat?.secondaryText?.text ?? "",
            })
          );
        setSuggestions(list);
        setOpen(list.length > 0);
        if (list.length === 0) setMessage("No matches — keep typing, or enter the address below.");
      } catch {
        if (mine === latest.current) setMessage("Address search is unavailable right now — type the address below.");
      }
    }, 250);
  }

  async function pick(s: Suggestion) {
    setOpen(false);
    setBusy(true);
    setMessage(null);
    try {
      const wantsCoords = Boolean(fields.lat && fields.lng);
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(s.placeId)}?sessionToken=${token.current}`,
        {
          headers: {
            "X-Goog-Api-Key": KEY!,
            "X-Goog-FieldMask": wantsCoords ? "addressComponents,location" : "addressComponents",
          },
        }
      );
      if (!res.ok) throw new Error("details failed");
      const place = (await res.json()) as {
        addressComponents?: PlaceComponent[];
        location?: { latitude: number; longitude: number };
      };
      const a = parsePlaceAddress(place.addressComponents);
      const form = formRef.current;
      setFieldValue(form, fields.street, a.street);
      setFieldValue(form, fields.unit, a.unit);
      setFieldValue(form, fields.city, a.city);
      setFieldValue(form, fields.state, a.state);
      setFieldValue(form, fields.zip, a.zip);
      setFieldValue(form, fields.country, a.country || "US");
      if (wantsCoords) {
        setFieldValue(form, fields.lat!, place.location ? String(place.location.latitude) : "");
        setFieldValue(form, fields.lng!, place.location ? String(place.location.longitude) : "");
      }
      setText([s.main, s.secondary].filter(Boolean).join(", "));
      setMessage(wantsCoords && place.location ? "Address filled in and pinned." : "Address filled in.");
      token.current = newToken(); // the session ended with this pick
    } catch {
      setMessage("Couldn't load that address — type it below instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={box} className="relative space-y-1">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-black/60">{label}</span>
        <input
          type="text"
          value={text}
          onChange={(e) => search(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          // Not submitted with the form: it has no name, and Enter must not save the job.
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
            if (e.key === "Escape") setOpen(false);
          }}
          autoComplete="off"
          placeholder="Start typing the address the customer gives you…"
          className="w-full rounded border border-black/20 px-2 py-1.5 text-sm"
        />
      </label>
      {open && (
        <ul className="absolute z-20 mt-0.5 max-h-64 w-full overflow-auto rounded border border-black/20 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => pick(s)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
              >
                <span className="font-medium">{s.main}</span>{" "}
                <span className="text-black/50">{s.secondary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(busy || message) && <p className="text-xs text-black/50">{busy ? "Loading address…" : message}</p>}
    </div>
  );
}

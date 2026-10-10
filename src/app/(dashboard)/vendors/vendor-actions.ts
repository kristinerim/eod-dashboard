"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSupervisor } from "@/lib/profile";
import { strOrNull } from "@/lib/formParse";
import { VENDOR_TIERS } from "@/lib/vendors";
import {
  SERVICE_CATEGORIES,
  classifyAddress,
  extractState,
  normalizePhone10,
  parseLatLongText,
  primaryAddress,
} from "@/lib/vendorImport/normalize";

type ActionResult = { success: true; id?: string } | { error: string };

// Whenever the address text changes, what we knew about the exact location is
// stale — recompute how usable it is and flag it for a one-time lookup.
function locationFields(address: string | null) {
  if (!address) {
    return { latitude: null, longitude: null, location_quality: "none" as const, needs_geocode: false, state: null };
  }
  const ll = parseLatLongText(address);
  if (ll) {
    return { latitude: ll.lat, longitude: ll.lng, location_quality: "latlong_in_address" as const, needs_geocode: false, state: null };
  }
  const quality = classifyAddress(primaryAddress(address));
  return {
    latitude: null,
    longitude: null,
    location_quality: quality,
    needs_geocode: quality === "street_address" || quality === "city_only",
    state: extractState(primaryAddress(address)),
  };
}

async function findVendorByPhone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  phone: string,
  excludeId?: string
) {
  let query = supabase.from("vendors").select("id, name").eq("phone", phone).limit(1);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.maybeSingle();
  return data;
}

export async function createVendor(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const name = strOrNull(formData.get("name"));
  if (!name) return { error: "Enter the vendor name." };

  const phoneRaw = strOrNull(formData.get("phone"));
  const phone = normalizePhone10(phoneRaw);
  if (phoneRaw && !phone) return { error: "Enter a valid 10-digit phone number." };
  if (phone) {
    const existing = await findVendorByPhone(supabase, phone);
    if (existing) return { error: `A vendor with this phone number already exists: ${existing.name}.` };
  }

  const address = strOrNull(formData.get("address"));
  const loc = locationFields(address);
  const { data, error } = await supabase
    .from("vendors")
    .insert({
      name,
      phone,
      address,
      ...loc,
      state: strOrNull(formData.get("state")) ?? loc.state,
      notes: strOrNull(formData.get("notes")),
      // The database forces new vendors from non-supervisors to "unclassified".
      tier: "unclassified",
      tier_source: "hub",
      import_key: `hub|${crypto.randomUUID()}`,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/vendors");
  return { success: true, id: data.id };
}

// Any signed-in team member can fill in vendor details — dispatchers learn
// them gradually as they work with vendors. Tier is NOT editable here.
export async function updateVendor(vendorId: string, formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: existing } = await supabase.from("vendors").select("id, address").eq("id", vendorId).single();
  if (!existing) return { error: "Vendor not found." };

  const name = strOrNull(formData.get("name"));
  if (!name) return { error: "Enter the vendor name." };

  const phoneRaw = strOrNull(formData.get("phone"));
  const phone = normalizePhone10(phoneRaw);
  if (phoneRaw && !phone) return { error: "Enter a valid 10-digit phone number." };
  if (phone) {
    const dup = await findVendorByPhone(supabase, phone, vendorId);
    if (dup) return { error: `Another vendor already has this phone number: ${dup.name}.` };
  }
  const secondaryRaw = strOrNull(formData.get("secondary_phone"));
  const secondary = normalizePhone10(secondaryRaw);
  if (secondaryRaw && !secondary) return { error: "Enter a valid 10-digit secondary phone number." };

  const address = strOrNull(formData.get("address"));
  const addressChanged = (address ?? "") !== (existing.address ?? "");
  const categories = formData
    .getAll("service_categories")
    .map(String)
    .filter((c) => (SERVICE_CATEGORIES as readonly string[]).includes(c));
  const heavyDutyOnly = formData.get("heavy_duty_only") === "on";

  const update: Record<string, unknown> = {
    name,
    contact_name: strOrNull(formData.get("contact_name")),
    phone,
    secondary_phone: secondary,
    email: strOrNull(formData.get("email")),
    secondary_email: strOrNull(formData.get("secondary_email")),
    address,
    state: strOrNull(formData.get("state")),
    service_categories: categories,
    equipment: strOrNull(formData.get("equipment")),
    heavy_duty_only: heavyDutyOnly,
    heavy_duty_capable: heavyDutyOnly || formData.get("heavy_duty_capable") === "on" || categories.includes("heavy_duty_tow"),
    notes: strOrNull(formData.get("notes")),
    is_active: formData.get("is_active") === "on",
  };
  if (addressChanged) {
    const loc = locationFields(address);
    Object.assign(update, {
      latitude: loc.latitude,
      longitude: loc.longitude,
      location_quality: loc.location_quality,
      needs_geocode: loc.needs_geocode,
    });
    if (!update.state) update.state = loc.state;
  }

  const { error } = await supabase.from("vendors").update(update).eq("id", vendorId);
  if (error) return { error: error.message };

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  return { success: true };
}

// Team leaders and admins only (also enforced by a database trigger). A reason
// is always required so the history explains every change.
export async function setVendorTier(vendorId: string, tier: string, reason: string): Promise<ActionResult> {
  const check = await requireSupervisor();
  if (!check.ok) return { error: check.error };
  if (!(VENDOR_TIERS as readonly string[]).includes(tier)) return { error: "Select a valid tier." };
  const why = reason.trim();
  if (!why) return { error: "Enter the reason for this tier — it is kept in the vendor's history." };

  const supabase = await createClient();
  const { data: existing } = await supabase.from("vendors").select("tier").eq("id", vendorId).single();
  if (!existing) return { error: "Vendor not found." };
  if (existing.tier === tier) return { error: "That is already this vendor's tier." };

  const { error } = await supabase
    .from("vendors")
    .update({ tier, tier_reason: why, tier_source: "hub" })
    .eq("id", vendorId);
  if (error) return { error: error.message };

  revalidatePath("/vendors");
  revalidatePath(`/vendors/${vendorId}`);
  return { success: true };
}

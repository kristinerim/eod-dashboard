import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile, isSupervisor } from "@/lib/profile";
import { TIER_LABELS, TIER_RULES, type Vendor, type VendorTier } from "@/lib/vendors";
import { TierBadge } from "../TierBadge";
import VendorEditForm from "./VendorEditForm";
import VendorTierForm from "./VendorTierForm";

const SOURCE_LABEL: Record<string, string> = {
  map: "Google My Maps (as exported)",
  review: "Decided during the import review",
  hub: "Set in the Hub",
};

function formatDateTime(d: string | null) {
  if (!d) return "-";
  return new Date(d).toLocaleString("en-US", { timeZone: "Asia/Manila" });
}

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase.from("vendors").select("*").eq("id", id).single();
  if (!data) notFound();
  const vendor = data as Vendor;

  const profile = await getCurrentProfile();
  const canSetTier = isSupervisor(profile?.role);

  const { data: history } = await supabase
    .from("vendor_tier_history")
    .select("id, old_tier, new_tier, reason, source, changed_by, changed_at")
    .eq("vendor_id", id)
    .order("changed_at", { ascending: false });

  // Who made each change. Names are read with the service role because a team
  // leader's own session can't read other people's profiles; only names are used.
  const ids = [...new Set((history ?? []).map((h) => h.changed_by).filter((x): x is string => !!x))];
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: people } = await createAdminClient().from("profiles").select("id, agent_name, email").in("id", ids);
    for (const p of people ?? []) names[p.id] = p.agent_name ?? p.email ?? "A team member";
  }

  const dnc = vendor.tier === "dnc_tier_3";

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/vendors" className="text-sm underline">
          ← Back to vendors
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{vendor.name}</h1>
        <TierBadge tier={vendor.tier} />
        {!vendor.is_active && <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs">Inactive</span>}
      </div>

      <div
        className={`rounded-lg border p-3 text-sm ${
          dnc ? "border-red-300 bg-red-50 text-red-900" : vendor.tier.startsWith("dnc") ? "border-amber-300 bg-amber-50 text-amber-900" : "border-black/10 bg-black/[0.02]"
        }`}
      >
        <div className="font-medium">{TIER_LABELS[vendor.tier as VendorTier]}</div>
        <div>{TIER_RULES[vendor.tier as VendorTier]}</div>
        {vendor.tier_reason && <div className="mt-1 text-xs">Reason: {vendor.tier_reason}</div>}
        <div className="mt-1 text-xs opacity-70">
          Tier source: {SOURCE_LABEL[vendor.tier_source]} · Last changed {formatDateTime(vendor.tier_changed_at)}
        </div>
      </div>

      {canSetTier && <VendorTierForm vendorId={vendor.id} currentTier={vendor.tier as VendorTier} />}

      <div>
        <h2 className="mb-2 text-sm font-semibold">Details</h2>
        <VendorEditForm vendor={vendor} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">From the Google My Maps import</h2>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-black/10 p-4 text-sm sm:grid-cols-2">
          {[
            ["Name in the map", vendor.name_original ?? "-"],
            ["Layers it was in", vendor.source_layers.join(", ") || "-"],
            ["Services (original wording)", vendor.services_original ?? "-"],
            ["Location quality", vendor.location_quality.replace(/_/g, " ")],
            [
              "Coordinates",
              vendor.latitude !== null ? `${vendor.latitude}, ${vendor.longitude}` : vendor.needs_geocode ? "Needs a one-time address lookup" : "-",
            ],
            ["Import notes", vendor.import_flags.join(", ") || "-"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <span className="text-black/50">{label}</span>
              <span className="text-right font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Tier history</h2>
        <div className="overflow-hidden rounded-lg border border-black/10">
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Change</th>
                <th className="px-4 py-2 font-medium">Reason</th>
                <th className="px-4 py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h) => (
                <tr key={h.id} className="border-t border-black/10 align-top">
                  <td className="whitespace-nowrap px-4 py-2">{formatDateTime(h.changed_at)}</td>
                  <td className="px-4 py-2">
                    {h.old_tier ? `${TIER_LABELS[h.old_tier as VendorTier]} → ` : "Set to "}
                    <span className="font-medium">{TIER_LABELS[h.new_tier as VendorTier]}</span>
                  </td>
                  <td className="px-4 py-2">{h.reason ?? "-"}</td>
                  <td className="px-4 py-2">
                    {h.changed_by ? (names[h.changed_by] ?? "A team member") : (SOURCE_LABEL[h.source ?? "hub"] ?? "Import")}
                  </td>
                </tr>
              ))}
              {(history ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-black/50">
                    No history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

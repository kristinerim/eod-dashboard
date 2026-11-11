import { getCurrentProfile, getRoster, isFullAdmin } from "@/lib/profile";
import TeamManager from "./TeamManager";

export default async function TeamPage() {
  const profile = await getCurrentProfile();
  if (!isFullAdmin(profile?.role)) {
    return (
      <p className="text-sm text-black/70">
        Only Operations Managers and Admin Coordinators can manage the Agent and Dispatcher lists.
      </p>
    );
  }

  const roster = await getRoster();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Agents &amp; Dispatchers</h1>
        <p className="text-sm text-black/60">
          The names offered in the Agent and Dispatcher dropdowns. Adding or deactivating someone updates every
          dropdown straight away. Deactivated people no longer appear for new assignments, but every past job, lead
          and report keeps their name exactly as it was.
        </p>
      </div>
      <TeamManager roster={roster} />
    </div>
  );
}

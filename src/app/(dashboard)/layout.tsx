import { cookies } from "next/headers";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getAgentNameOptions, getCurrentProfile, getDispatcherNameOptions } from "@/lib/profile";
import { ROLE_MENU_LABELS } from "@/lib/roles";
import { RosterProvider } from "@/components/RosterProvider";
import ClockInPrompt from "@/components/ClockInPrompt";
import AppShell from "@/components/shell/AppShell";
import { signOut } from "./actions";
import { getUnreadCount } from "./shell-actions";

function initialsFor(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const user = await getCurrentUser();
  const initialCollapsed = (await cookies()).get("qthub-sidebar")?.value === "collapsed";

  // The profile, the open-clock-in lookup and the unread count don't depend on each other.
  const [profile, openEntryResult, agentNames, dispatcherNames, unreadCount] = await Promise.all([
    getCurrentProfile(),
    user
      ? supabase.from("time_entries").select("id").eq("user_id", user.id).is("clock_out", null).maybeSingle()
      : Promise.resolve(null),
    getAgentNameOptions(),
    getDispatcherNameOptions(),
    getUnreadCount(),
  ]);
  const hasOpenEntry = user ? !!openEntryResult?.data : true;

  const displayName = profile?.agent_name || user?.email || "Signed in";
  const shellUser = {
    name: displayName,
    initials: initialsFor(displayName),
    roleLabel: (profile?.role && ROLE_MENU_LABELS[profile.role]) || "Team member",
  };

  return (
    <>
      <AppShell user={shellUser} unreadCount={unreadCount} initialCollapsed={initialCollapsed} signOutAction={signOut}>
        <RosterProvider agents={agentNames} dispatchers={dispatcherNames}>
          {children}
        </RosterProvider>
      </AppShell>
      {user && <ClockInPrompt hasOpenEntry={hasOpenEntry} />}
    </>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, isFullAdmin } from "@/lib/profile";
import ClockInPrompt from "@/components/ClockInPrompt";
import { signOut } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = await getCurrentProfile();

  let hasOpenEntry = true;
  if (user) {
    const { data: openEntry } = await supabase
      .from("time_entries")
      .select("id")
      .eq("user_id", user.id)
      .is("clock_out", null)
      .maybeSingle();
    hasOpenEntry = !!openEntry;
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-3">
        <Link href="/" className="text-sm font-semibold">
          EOD Report Dashboard
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/dispatched" className="text-black/70 hover:text-black">
            Dispatched
          </Link>
          <Link href="/pending-completion" className="text-black/70 hover:text-black">
            Pending Completion
          </Link>
          <Link href="/weekly" className="text-black/70 hover:text-black">
            Weekly summaries
          </Link>
          <Link href="/hours" className="text-black/70 hover:text-black">
            Hours
          </Link>
          <Link href="/upload" className="text-black/70 hover:text-black">
            Upload report
          </Link>
          {isFullAdmin(profile?.role) && (
            <Link href="/agents" className="text-black/70 hover:text-black">
              Users
            </Link>
          )}
          <span className="text-black/40">{user?.email}</span>
          <form action={signOut}>
            <button type="submit" className="text-black/70 hover:text-black">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
      {user && <ClockInPrompt hasOpenEntry={hasOpenEntry} />}
    </div>
  );
}

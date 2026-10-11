import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getCurrentProfile, isFullAdmin } from "@/lib/profile";
import ClockInPrompt from "@/components/ClockInPrompt";
import { signOut } from "./actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const user = await getCurrentUser();

  // The profile and the open-clock-in lookup don't depend on each other.
  const [profile, openEntryResult] = await Promise.all([
    getCurrentProfile(),
    user
      ? supabase.from("time_entries").select("id").eq("user_id", user.id).is("clock_out", null).maybeSingle()
      : Promise.resolve(null),
  ]);
  const hasOpenEntry = user ? !!openEntryResult?.data : true;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 print:hidden">
        <Link href="/" className="text-sm font-semibold">
          EOD Report Dashboard
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/leads" className="text-black/70 hover:text-black">
            Leads
          </Link>
          <Link href="/dispatched" className="text-black/70 hover:text-black">
            Dispatched
          </Link>
          <Link href="/pending-completion" className="text-black/70 hover:text-black">
            DPA
          </Link>
          <Link href="/completed-jobs" className="text-black/70 hover:text-black">
            Completed
          </Link>
          <Link href="/cancelled-jobs" className="text-black/70 hover:text-black">
            Cancelled
          </Link>
          <Link href="/invoices" className="text-black/70 hover:text-black">
            Invoices
          </Link>
          <Link href="/vendors" className="text-black/70 hover:text-black">
            Vendors
          </Link>
          <Link href="/weekly" className="text-black/70 hover:text-black">
            Weekly summaries
          </Link>
          <Link href="/hours" className="text-black/70 hover:text-black">
            Hours
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
      <main className="flex-1 px-6 py-6 print:p-0">{children}</main>
      {user && <ClockInPrompt hasOpenEntry={hasOpenEntry} />}
    </div>
  );
}

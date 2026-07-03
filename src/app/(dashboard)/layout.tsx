import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
          <Link href="/weekly" className="text-black/70 hover:text-black">
            Weekly summaries
          </Link>
          <Link href="/upload" className="text-black/70 hover:text-black">
            Upload report
          </Link>
          <span className="text-black/40">{user?.email}</span>
          <form action={signOut}>
            <button type="submit" className="text-black/70 hover:text-black">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrCreateTodaysReport } from "@/app/(dashboard)/reports/[id]/job-actions";
import { getUnreadCount } from "@/app/(dashboard)/shell-actions";
import { MessagesPanel, ProfilePanel, type ShellUser } from "./ShellPanels";

// Line icons, one path each.
const ICONS = {
  plus: "M12 5v14M5 12h14",
  home: "M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6",
  jobs: "M3 8h18v12H3zM8 8V5h8v3M3 13h18",
  leads: "M3 4h18l-7 9v6l-4 2v-8z",
  dispatched: "M2 6h11v10H2zM13 9h5l3 3v4h-8M4 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
  dpa: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 7v5l3 2",
  done: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M8 12l3 3 5-6",
  customers: "M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M6 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M20 20v-2a3 3 0 0 0-2-2.8M15.5 3.5a3.5 3.5 0 0 1 0 7",
  invoices: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
  vendors: "M3 9l2-5h14l2 5M3 9h18v11H3zM9 20v-6h6v6",
  cancelled: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M9 9l6 6M15 9l-6 6",
  weekly: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  chat: "M4 5h16v11H9l-5 4z",
  panel: "M4 5h16v14H4zM9 5v14",
  chevron: "M6 9l6 6 6-6",
} as const;

function Icon({ d, size = 20, strokeWidth = 1.8 }: { d: string; size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

type NavItem = { label: string; href: string; icon: string; match: (p: string) => boolean };

const startsWith = (...prefixes: string[]) => (p: string) => prefixes.some((x) => p === x || p.startsWith(`${x}/`));

const NAV_MAIN: NavItem[] = [
  { label: "Home", href: "/", icon: ICONS.home, match: (p) => p === "/" },
  { label: "Jobs", href: "/jobs", icon: ICONS.jobs, match: startsWith("/jobs", "/reports") },
  { label: "Leads", href: "/leads", icon: ICONS.leads, match: startsWith("/leads") },
  { label: "Dispatched", href: "/dispatched", icon: ICONS.dispatched, match: startsWith("/dispatched") },
  { label: "DPA", href: "/pending-completion", icon: ICONS.dpa, match: startsWith("/pending-completion") },
  { label: "Completed", href: "/completed-jobs", icon: ICONS.done, match: startsWith("/completed-jobs") },
  { label: "Customers", href: "/customers", icon: ICONS.customers, match: startsWith("/customers") },
  { label: "Invoices", href: "/invoices", icon: ICONS.invoices, match: startsWith("/invoices") },
  { label: "Vendors", href: "/vendors", icon: ICONS.vendors, match: startsWith("/vendors") },
];

// Pages that used to be in the top menu and still need a way in.
const NAV_MORE: NavItem[] = [
  { label: "Weekly summaries", href: "/weekly", icon: ICONS.weekly, match: startsWith("/weekly") },
  { label: "Hours", href: "/hours", icon: ICONS.dpa, match: startsWith("/hours") },
  { label: "Cancelled", href: "/cancelled-jobs", icon: ICONS.cancelled, match: startsWith("/cancelled-jobs") },
];

export const SIDEBAR_COOKIE = "qthub-sidebar";

type Open = "messages" | "profile" | null;

export default function AppShell({
  user,
  unreadCount: initialUnread,
  initialCollapsed,
  signOutAction,
  children,
}: {
  user: ShellUser;
  unreadCount: number;
  initialCollapsed: boolean;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  // The sidebar choice is remembered in a cookie, so the very first paint
  // already has the right width (no flash).
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // Which menu is open, and on which page it was opened: moving to another page closes it.
  const [openState, setOpenState] = useState<{ panel: Open; path: string }>({ panel: null, path: "" });
  const open: Open = openState.path === pathname ? openState.panel : null;
  const setOpen = (panel: Open) => setOpenState({ panel, path: pathname });
  // The unread number from the last live update, and the server value it was based on.
  const [live, setLive] = useState<{ value: number; base: number } | null>(null);
  const unread = live && live.base === initialUnread ? live.value : initialUnread;
  const [creating, startCreating] = useTransition();
  const headerRight = useRef<HTMLDivElement>(null);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  const refreshUnread = useCallback(() => {
    getUnreadCount()
      .then((value) => setLive({ value, base: initialUnread }))
      .catch(() => {});
  }, [initialUnread]);

  // Keep the unread number current as messages arrive, without reloading the page.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refreshUnread, 1000);
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);
      channel = supabase.channel(`shell-unread-${Math.random().toString(36).slice(2)}`);
      channel.on("postgres_changes", { event: "*", schema: "public", table: "communications" }, schedule);
      channel.subscribe();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [refreshUnread]);

  // Close a menu with Escape or by clicking anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpenState({ panel: null, path: pathname });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => {
      if (headerRight.current && !headerRight.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, pathname]);

  function createJob() {
    startCreating(async () => {
      const result = await getOrCreateTodaysReport();
      if ("error" in result) {
        alert(result.error);
        return;
      }
      router.push(`/reports/${result.id}?add=1`);
    });
  }

  const all = [...NAV_MAIN, ...NAV_MORE];
  const current = all.find((i) => i.match(pathname));
  const isHome = pathname === "/";

  // Labels show when the menu is open. On a narrow screen it is always icons only.
  const labelCls = collapsed ? "hidden" : "hidden md:inline";
  const itemLayout = collapsed ? "justify-center" : "justify-center md:justify-start md:px-3";

  const renderItem = (item: NavItem) => {
    const active = item.match(pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        className={`flex h-[42px] items-center gap-3 rounded-lg text-sm ${itemLayout} ${
          active
            ? "bg-qt-tint font-semibold text-qt-accent shadow-[inset_3px_0_0_var(--color-qt-accent)]"
            : "font-medium text-[#2b3646] hover:bg-[#eef1f5]"
        }`}
      >
        <Icon d={item.icon} />
        <span className={labelCls}>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="flex min-h-[calc(100vh/var(--qt-zoom))] flex-1 bg-white text-qt-ink">
      <aside
        className={`sticky top-0 flex h-[calc(100vh/var(--qt-zoom))] shrink-0 flex-col gap-1 overflow-y-auto border-r border-qt-line bg-white px-3 py-4 transition-[width] duration-200 print:hidden ${
          collapsed ? "w-[76px]" : "w-[76px] md:w-64"
        }`}
      >
        <Link
          href="/"
          aria-label="Quick Towing Hub home"
          className={`mb-3 flex items-center gap-3 px-1 ${collapsed ? "justify-center" : "justify-center md:justify-start"}`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-qt-accent text-sm font-bold tracking-wide text-white">
            QT
          </span>
          <span className={`${collapsed ? "hidden" : "hidden md:flex"} flex-col leading-tight`}>
            <span className="text-[15px] font-bold">Quick Towing Hub</span>
            <span className="text-xs text-qt-muted">Dispatch &amp; operations</span>
          </span>
        </Link>

        <button
          type="button"
          onClick={createJob}
          disabled={creating}
          title="Create Job"
          aria-label="Create Job"
          className="mb-3 flex h-11 items-center justify-center gap-2.5 rounded-[10px] bg-qt-accent text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          <Icon d={ICONS.plus} strokeWidth={2} />
          <span className={labelCls}>{creating ? "Opening…" : "Create Job"}</span>
        </button>

        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV_MAIN.map(renderItem)}
        </nav>

        <div className="mx-1 mb-1 mt-3 border-t border-qt-line pt-3">
          <div className={`px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-qt-muted ${labelCls}`}>Reports &amp; time</div>
          <nav aria-label="Reports and time" className="flex flex-col gap-1">
            {NAV_MORE.map(renderItem)}
          </nav>
        </div>

        <div className="min-h-6 flex-1" />

        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          aria-expanded={!collapsed}
          className={`flex h-[42px] items-center gap-3 rounded-lg text-sm font-medium text-qt-muted hover:bg-[#eef1f5] ${itemLayout}`}
        >
          <Icon d={ICONS.panel} />
          <span className={labelCls}>Collapse menu</span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex min-h-14 items-center gap-2 border-b border-qt-line bg-white px-4 py-2 md:px-6 print:hidden">
          <span className="text-base font-semibold">{current?.label ?? "Quick Towing Hub"}</span>
          <span className="flex-1" />
          <div ref={headerRight} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(open === "messages" ? null : "messages")}
              aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
              aria-expanded={open === "messages"}
              className={`relative flex h-11 w-11 items-center justify-center rounded-[10px] text-[#2b3646] hover:bg-[#eef1f5] ${
                open === "messages" ? "bg-[#eef1f5]" : ""
              }`}
            >
              <Icon d={ICONS.chat} size={22} />
              {unread > 0 && (
                <span className="absolute right-[3px] top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#c62828] px-1 text-[11px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setOpen(open === "profile" ? null : "profile")}
              aria-label="User profile"
              aria-expanded={open === "profile"}
              className={`flex h-11 items-center gap-2.5 rounded-[10px] pl-1.5 pr-2 text-left hover:bg-[#eef1f5] ${
                open === "profile" ? "bg-[#eef1f5]" : ""
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-qt-accent text-xs font-bold text-white">
                {user.initials}
              </span>
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="max-w-[160px] truncate text-[13px] font-semibold">{user.name}</span>
                <span className="text-xs text-qt-muted">{user.roleLabel}</span>
              </span>
              <Icon d={ICONS.chevron} size={16} strokeWidth={2} />
            </button>

            {open === "messages" && <MessagesPanel onClose={() => setOpen(null)} onChanged={refreshUnread} />}
            {open === "profile" && <ProfilePanel user={user} signOutAction={signOutAction} onClose={() => setOpen(null)} />}
          </div>
        </header>

        <main className={`flex-1 px-6 py-6 print:p-0 ${isHome ? "bg-qt-canvas" : "bg-white"}`}>{children}</main>
      </div>
    </div>
  );
}

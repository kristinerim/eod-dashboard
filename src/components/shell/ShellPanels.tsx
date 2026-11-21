"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getMessagePanel,
  getProfilePanel,
  markAllMessagesRead,
  markMessageRead,
  type MessagePanelData,
  type ProfilePanelData,
  type ShellMessage,
} from "@/app/(dashboard)/shell-actions";

export type ShellUser = { name: string; initials: string; roleLabel: string };

function CloseButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-qt-muted hover:bg-qt-canvas"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

function initialsOf(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
}

const TEAM_SHOWN = 8;

const PANEL = "absolute right-4 top-full z-30 mt-2 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-qt-line bg-white shadow-xl md:right-6";

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type Tab = "all" | "sms" | "email";

export function MessagesPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<MessagePanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [seen, setSeen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getMessagePanel()
      .then((r) => {
        if (cancelled) return;
        if ("error" in r) setError(r.error);
        else setData(r);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load messages.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const all = data?.messages ?? [];
  const shown = all.filter((m) => tab === "all" || m.channel === tab);
  const unread = all.filter((m) => m.unread && !seen.has(m.id)).length;
  const count = (c: Tab) => (c === "all" ? all.length : all.filter((m) => m.channel === c).length);

  function open(m: ShellMessage) {
    if (m.unread && !seen.has(m.id)) {
      setSeen((prev) => new Set(prev).add(m.id));
      markMessageRead(m.id).then(onChanged);
    }
    if (m.href) {
      router.push(m.href);
      onClose();
    }
  }

  function readAll() {
    setSeen(new Set(all.filter((m) => m.unread).map((m) => m.id)));
    markAllMessagesRead().then(onChanged);
  }

  const notConnected = data && (!data.emailConnected || !data.smsConnected);

  return (
    <div role="dialog" aria-label="Messages" className={PANEL}>
      <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <h2 className="flex-1 text-base font-bold">Messages</h2>
        {unread > 0 && (
          <button type="button" onClick={readAll} className="text-xs font-medium text-qt-accent hover:underline">
            Mark all read
          </button>
        )}
        <span className="text-xs text-qt-muted">{unread} unread</span>
        <CloseButton label="Close messages" onClose={onClose} />
      </div>

      <div className="flex gap-1.5 px-4 pb-2.5">
        {(["all", "sms", "email"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-[30px] rounded-full border px-3 text-[13px] font-semibold ${
              tab === t ? "border-qt-accent bg-qt-accent text-white" : "border-[#c9d1dc] bg-white text-[#2b3646] hover:bg-qt-canvas"
            }`}
          >
            {t === "all" ? "All" : t === "sms" ? "SMS" : "Email"} ({count(t)})
          </button>
        ))}
      </div>

      <div className="max-h-[420px] overflow-y-auto border-t border-qt-line">
        {!data && !error && <p className="px-4 py-8 text-center text-sm text-qt-muted">Loading…</p>}
        {error && <p className="px-4 py-8 text-center text-sm text-red-700">{error}</p>}
        {data && shown.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-qt-muted">
            No {tab === "all" ? "messages" : tab === "sms" ? "text messages" : "emails"} yet. Messages sent to or received from
            customers and vendors will appear here, newest first.
          </p>
        )}
        {shown.map((m) => {
          const isUnread = m.unread && !seen.has(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => open(m)}
              title={m.href ? `Opens ${m.linkLabel}` : undefined}
              className={`flex w-full items-start gap-3 border-t border-[#eef1f5] px-4 py-3 text-left first:border-t-0 hover:bg-qt-canvas ${
                isUnread ? "bg-qt-tint/50" : "bg-white"
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-qt-line text-[13px] font-bold text-[#2b3646]">
                {initialsOf(m.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className={`flex-1 truncate text-sm ${isUnread ? "font-bold" : "font-medium"}`}>{m.name}</span>
                  <span className="shrink-0 text-xs text-qt-muted">{timeAgo(m.createdAt)}</span>
                </span>
                <span className="line-clamp-2 text-[13px] text-[#2b3646]">{m.preview}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-[#eef1f5] px-1.5 text-[11px] font-semibold uppercase text-[#2b3646]">{m.channel}</span>
                  <span className="rounded-md bg-[#eef1f5] px-1.5 text-[11px] font-semibold capitalize text-[#2b3646]">
                    {m.partyType === "other" ? "Other" : m.partyType}
                  </span>
                  <span className="rounded-md bg-[#eef1f5] px-1.5 text-[11px] font-semibold text-[#2b3646]">
                    {m.direction === "inbound" ? "Received" : "Sent"}
                  </span>
                  {m.href && <span className="text-xs font-semibold text-qt-accent">{m.linkLabel} →</span>}
                </span>
              </span>
              {isUnread && <span role="img" aria-label="Unread" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-qt-accent" />}
            </button>
          );
        })}
      </div>

      {notConnected && (
        <div className="border-t border-qt-line bg-[#f7f9fb] px-4 py-3">
          <p className="rounded-lg bg-[#fff4d6] px-2.5 py-1.5 text-xs text-[#5c3b00]">
            {!data.emailConnected && !data.smsConnected
              ? "Email and text sending are not connected yet. Messages will appear here once they are."
              : !data.emailConnected
                ? "Email sending is not connected yet."
                : "Text messaging is not connected yet."}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function Avatar({ initials, size }: { initials: string; size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-qt-accent font-bold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </span>
  );
}

export function ProfilePanel({
  user,
  signOutAction,
  onClose,
}: {
  user: ShellUser;
  signOutAction: () => Promise<void>;
  onClose: () => void;
}) {
  const [data, setData] = useState<ProfilePanelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProfilePanel()
      .then((r) => {
        if (cancelled) return;
        if ("error" in r) setError(r.error);
        else setData(r);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your hours.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const manageBtn =
    "flex h-10 w-full items-center justify-center rounded-lg border border-[#c9d1dc] bg-white text-sm font-semibold hover:bg-qt-canvas";

  return (
    <div role="dialog" aria-label="User profile" className={`${PANEL} max-h-[min(680px,calc(100vh-5rem))] overflow-y-auto`}>
      <div className="flex items-center gap-3.5 p-4">
        <Avatar initials={user.initials} size={48} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-bold">{user.name}</span>
          <span className="self-start rounded-full bg-qt-tint px-2.5 text-xs font-semibold text-qt-accent">{user.roleLabel}</span>
        </span>
        <span className="self-start">
          <CloseButton label="Close profile" onClose={onClose} />
        </span>
      </div>

      <div className="px-4 pb-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-qt-muted">Hours worked</div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-sm text-qt-muted">Loading…</p>}
        {data && (
          <>
            <div className="flex gap-2">
              <div className="flex-1 rounded-xl bg-qt-canvas px-3 py-2.5">
                <div className="text-xs text-qt-muted">Today</div>
                <div className="text-lg font-bold">{data.todayHours}</div>
              </div>
              <div className="flex-1 rounded-xl bg-qt-canvas px-3 py-2.5">
                <div className="text-xs text-qt-muted">This week</div>
                <div className="text-lg font-bold">{data.weekHours}</div>
              </div>
            </div>
            <p className="mt-2 text-xs text-qt-muted">
              {data.clockedInSince ? `Clocked in since ${data.clockedInSince}.` : "Not clocked in right now."}{" "}
              <Link href="/hours" onClick={onClose} className="font-medium text-qt-accent hover:underline">
                Open Hours
              </Link>
            </p>
          </>
        )}
      </div>

      {data?.team && (
        <div className="border-t border-qt-line px-4 pb-2 pt-3.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="flex-1 text-sm font-bold">Agents / Dispatchers</span>
            <span className="text-xs text-qt-muted">
              {data.teamClockedIn} clocked in · {data.teamTotal} on the team
            </span>
          </div>
          {data.team.length === 0 && <p className="py-2 text-sm text-qt-muted">No agent or dispatcher has a login yet.</p>}
          {data.team.slice(0, TEAM_SHOWN).map((p) => (
            <div key={`${p.name}-${p.role}`} className="flex items-center gap-2.5 rounded-lg px-1 py-2 hover:bg-[#f7f9fb]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-qt-line text-xs font-bold text-[#2b3646]">
                {initialsOf(p.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[13px] font-semibold">{p.name}</span>
                <span className="text-xs text-qt-muted">
                  {p.role}
                  {p.hours ? ` · ${p.hours} today` : ""}
                </span>
              </span>
              {p.clockedIn ? (
                <span className="whitespace-nowrap rounded-full bg-[#e3f6ea] px-2.5 text-xs font-semibold text-[#146c3a]">Clocked in</span>
              ) : (
                <span className="whitespace-nowrap rounded-full bg-[#eef1f5] px-2.5 text-xs font-semibold text-[#2b3646]">Clocked out</span>
              )}
            </div>
          ))}
          {data.team.length > TEAM_SHOWN && (
            <p className="px-1 py-1.5 text-xs text-qt-muted">
              + {data.team.length - TEAM_SHOWN} more with a login.{" "}
              <Link href="/hours" onClick={onClose} className="font-medium text-qt-accent hover:underline">
                See everyone&apos;s hours
              </Link>
            </p>
          )}
          {data.canManageTeam ? (
            <Link href="/team" onClick={onClose} className={`${manageBtn} my-2`}>
              Manage Agents &amp; Dispatchers
            </Link>
          ) : (
            <p className="px-1 pb-2 pt-1.5 text-xs text-qt-muted">View only. Adding or changing people is done by an Admin or the Owner.</p>
          )}
        </div>
      )}

      {data?.users && (
        <div className="border-t border-qt-line px-4 pb-2 pt-3.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="flex-1 text-sm font-bold">Users</span>
            <span className="text-xs text-qt-muted">{data.users.length} users</span>
          </div>
          {data.users.map((u, i) => (
            <div key={`${u.name}-${i}`} className="flex items-center gap-2.5 rounded-lg px-1 py-2 hover:bg-[#f7f9fb]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-qt-line text-xs font-bold text-[#2b3646]">
                {initialsOf(u.name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{u.name}</span>
              <span className="whitespace-nowrap rounded-full bg-[#eef1f5] px-2.5 text-xs font-semibold text-[#2b3646]">{u.role}</span>
            </div>
          ))}
        </div>
      )}

      {data?.canManageUsers && (
        <div className="px-4 pb-3 pt-1">
          <Link href="/agents" onClick={onClose} className={manageBtn}>
            Manage users
          </Link>
        </div>
      )}

      <div className="border-t border-qt-line px-4 py-2">
        <form action={signOutAction}>
          <button type="submit" className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-[#2b3646] hover:bg-qt-canvas">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 4H4v16h5M16 8l4 4-4 4M20 12H9" />
            </svg>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

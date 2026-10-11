"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// With a whole team editing at once, a change anywhere reaches every open page.
// Refreshing on each one would reload these pages constantly, so changes are
// gathered: wait a moment for more to arrive, never refresh more than once
// every few seconds, and don't bother a tab nobody is looking at (it catches up
// the moment it's opened again).
const SETTLE_MS = 1500;
const MIN_GAP_MS = 5000;

interface Props {
  tables: ("jobs" | "reports" | "time_entries" | "leads" | "invoices" | "job_notes")[];
  filter?: string;
}

export default function RealtimeRefresh({ tables, filter }: Props) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefresh = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    // The underlying Supabase client is a shared singleton, so under
    // React Strict Mode's dev double-invoke, a stale effect run's async
    // setup could otherwise land after a fresh run already subscribed a
    // channel with the same name. Guard with a cancelled flag and a
    // per-mount-unique channel name so each run only ever touches its own.
    let cancelled = false;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const channelName = `realtime-refresh-${tables.join("-")}-${filter ?? "all"}-${Math.random().toString(36).slice(2)}`;

    function refreshNow() {
      pending.current = false;
      lastRefresh.current = Date.now();
      router.refresh();
    }
    function scheduleRefresh() {
      if (document.hidden) {
        pending.current = true;
        return;
      }
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const wait = Math.max(SETTLE_MS, lastRefresh.current + MIN_GAP_MS - Date.now());
      timeoutRef.current = setTimeout(refreshNow, wait);
    }
    function onVisible() {
      if (!document.hidden && pending.current) scheduleRefresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase.channel(channelName);
      for (const table of tables) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
          scheduleRefresh
        );
      }
      channel.subscribe();
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      authSubscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(","), filter]);

  return null;
}

"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  tables: ("jobs" | "reports")[];
  filter?: string;
}

export default function RealtimeRefresh({ tables, filter }: Props) {
  const router = useRouter();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => router.refresh(), 300);
          }
        );
      }
      channel.subscribe();
    });

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      authSubscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(","), filter]);

  return null;
}

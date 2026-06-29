"use client";

import { useEffect, useState } from "react";

import { API_BASE, authHeaders, type ConversationSummary } from "@/lib/tasksMessaging";

export function useMessagingUnreadCount(
  clinicId: string,
  userId: string | null | undefined,
): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!clinicId || !userId) {
      setCount(0);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `${API_BASE}/messaging/${encodeURIComponent(clinicId)}/conversations?user_id=${encodeURIComponent(userId!)}`,
          { headers: await authHeaders() },
        );
        if (!res.ok || cancelled) return;
        const convs = (await res.json()) as ConversationSummary[];
        const total = (Array.isArray(convs) ? convs : []).reduce(
          (sum, c) => sum + (c.unread_count ?? 0),
          0,
        );
        if (!cancelled) setCount(total);
      } catch {
        if (!cancelled) setCount(0);
      }
    }

    void load();
    const interval = setInterval(() => void load(), 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [clinicId, userId]);

  return count;
}

"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type PiFeeCacheEntry = {
  rates: Map<string, number>;
  error: string | null;
};

const piFeeCache = new Map<string, PiFeeCacheEntry>();

function buildRatesMap(rows: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const code = String((row as { cpt_code?: string }).cpt_code ?? "")
      .trim()
      .toUpperCase();
    const charge = Number((row as { pi_charge?: number }).pi_charge);
    if (code && Number.isFinite(charge) && charge > 0) {
      map.set(code, charge);
    }
  }
  return map;
}

export function usePiFeeSchedule(clinicId: string | null | undefined): {
  piRates: Map<string, number>;
  loading: boolean;
  error: string | null;
} {
  const cid = clinicId?.trim() ?? "";
  const [piRates, setPiRates] = useState<Map<string, number>>(() => {
    if (!cid) return new Map();
    return piFeeCache.get(cid)?.rates ?? new Map();
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!cid) return null;
    return piFeeCache.get(cid)?.error ?? null;
  });

  useEffect(() => {
    if (!cid) {
      setPiRates(new Map());
      setError(null);
      setLoading(false);
      return;
    }

    const cached = piFeeCache.get(cid);
    if (cached) {
      setPiRates(cached.rates);
      setError(cached.error);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? "";
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch(
          `${API_BASE}/api/fee-schedule/pi?clinic_id=${encodeURIComponent(cid)}`,
          { headers },
        );
        if (!res.ok) {
          const msg =
            (await res.text().catch(() => "")).trim() ||
            `Could not load PI fee schedule (${res.status})`;
          throw new Error(msg);
        }

        const json: unknown = await res.json();
        const map = buildRatesMap(json);
        if (!cancelled) {
          piFeeCache.set(cid, { rates: map, error: null });
          setPiRates(map);
          setError(null);
        }
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not load PI fee schedule.";
        if (!cancelled) {
          piFeeCache.set(cid, { rates: new Map(), error: msg });
          setPiRates(new Map());
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cid]);

  return { piRates, loading, error };
}

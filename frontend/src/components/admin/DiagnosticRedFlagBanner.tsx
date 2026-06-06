"use client";

import { useCallback, useEffect, useState } from "react";

import { DS_PRIMARY_BTN } from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const POLL_MS = 30_000;

export type DiagnosticAnalysis = {
  id: string;
  status?: string;
  red_flags?: string[] | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

type Props = {
  patientId: string;
  clinicId: string;
  onReviewed?: () => void;
};

export function DiagnosticRedFlagBanner({
  patientId,
  clinicId,
  onReviewed,
}: Props) {
  const [pending, setPending] = useState<DiagnosticAnalysis[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}/diagnostics?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as DiagnosticAnalysis[];
      const flagged = (Array.isArray(rows) ? rows : []).filter((r) => {
        const flags = Array.isArray(r.red_flags) ? r.red_flags : [];
        return flags.length > 0 && (r.status ?? "").toLowerCase() === "pending";
      });
      setPending(flagged);
    } catch {
      /* ignore */
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  async function markReviewed(analysisId: string) {
    setBusyId(analysisId);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}/diagnostics/${encodeURIComponent(analysisId)}/review?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: "PATCH", headers: h, body: "{}" },
      );
      if (res.ok) {
        await load();
        onReviewed?.();
      }
    } finally {
      setBusyId(null);
    }
  }

  if (pending.length === 0) return null;

  const first = pending[0];

  return (
    <div
      className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <p className="text-sm font-medium">
        ⚠ Red Flag Detected — Review imaging summary before proceeding
        {pending.length > 1 ? ` (${pending.length} pending)` : ""}
      </p>
      <button
        type="button"
        disabled={busyId === first.id}
        onClick={() => void markReviewed(first.id)}
        className={`${DS_PRIMARY_BTN} shrink-0 bg-amber-700 hover:bg-amber-800 disabled:opacity-60`}
      >
        {busyId === first.id ? "Saving…" : "Mark as Reviewed"}
      </button>
    </div>
  );
}

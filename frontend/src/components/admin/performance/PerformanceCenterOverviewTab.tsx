"use client";

import { useCallback, useEffect, useState } from "react";

import { DS_CARD } from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import {
  EMPTY_APS_TIER_COUNTS,
  type ApsClinicSessionStats,
  type ApsTierCounts,
  apsTierCountShortLabel,
  apsTierCountTextClass,
  tierCountsTotal,
} from "@/components/admin/performance/apsTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const TIER_ORDER = ["high", "moderate", "low"] as const;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function StatCard({
  value,
  label,
  sub,
}: {
  value: string;
  label: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
    </div>
  );
}

function TierBreakdownCard({ counts }: { counts: ApsTierCounts }) {
  const parts = TIER_ORDER.filter((tier) => counts[tier] > 0);
  const totalTiered = tierCountsTotal(counts);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {totalTiered === 0 ? (
        <p className="text-2xl font-bold text-gray-900">—</p>
      ) : (
        <p className="text-xl font-bold leading-snug sm:text-2xl">
          {parts.map((tier, index) => (
            <span key={tier}>
              {index > 0 ? (
                <span className="font-normal text-gray-400"> · </span>
              ) : null}
              <span className={apsTierCountTextClass(tier)}>
                {counts[tier]} {apsTierCountShortLabel(tier)}
              </span>
            </span>
          ))}
        </p>
      )}
      <p className="mt-1 text-sm font-medium text-gray-600">Pattern tiers</p>
      <p className="mt-0.5 text-xs text-gray-500">
        {totalTiered === 0
          ? "No sessions with an overall pattern tier yet"
          : `${totalTiered} session${totalTiered === 1 ? "" : "s"} with a pattern tier`}
      </p>
    </div>
  );
}

export default function PerformanceCenterOverviewTab() {
  const { clinicId } = useClinic();
  const [stats, setStats] = useState<ApsClinicSessionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!clinicId) {
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/aps/sessions?clinic_id=${encodeURIComponent(clinicId)}&limit=0`,
        { headers: h },
      );
      if (!res.ok) {
        setStats(null);
        setError("Could not load performance overview.");
        return;
      }
      const data = (await res.json()) as { stats?: ApsClinicSessionStats };
      setStats(data.stats ?? null);
    } catch {
      setStats(null);
      setError("Could not load performance overview.");
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  }

  const s = stats ?? {
    total_sessions: 0,
    sessions_this_month: 0,
    distinct_patients: 0,
    tier_counts: EMPTY_APS_TIER_COUNTS,
  };

  const tierCounts = s.tier_counts ?? EMPTY_APS_TIER_COUNTS;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          value={String(s.total_sessions)}
          label="Total Assessments"
          sub={
            s.total_sessions === 1
              ? "1 Kinvent session on record"
              : `${s.total_sessions} Kinvent sessions on record`
          }
        />
        <StatCard
          value={String(s.sessions_this_month)}
          label="This Month"
          sub="Sessions with date in the current calendar month"
        />
        <StatCard
          value={String(s.distinct_patients)}
          label="Athletes Tested"
          sub={
            s.distinct_patients === 1
              ? "1 patient with at least one session"
              : `${s.distinct_patients} patients with at least one session`
          }
        />
        <TierBreakdownCard counts={tierCounts} />
      </div>

      {s.total_sessions === 0 ? (
        <div className={`${DS_CARD} py-10 text-center`}>
          <p className="text-base font-medium text-gray-900">No assessments yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Import a Kinvent force-plate PDF from the Assessments tab to start building
            clinic-wide performance data.
          </p>
        </div>
      ) : null}
    </div>
  );
}

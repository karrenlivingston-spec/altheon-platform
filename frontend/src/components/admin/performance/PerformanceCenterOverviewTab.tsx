"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronRight, Sparkles } from "lucide-react";

import {
  DS_CARD,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import { ApsSessionDetail } from "@/components/admin/performance/ApsSessionDetail";
import PerformanceCenterTestingVolumeChart from "@/components/admin/performance/PerformanceCenterTestingVolumeChart";
import PerformanceCenterTierDonut from "@/components/admin/performance/PerformanceCenterTierDonut";
import {
  EMPTY_APS_TIER_COUNTS,
  type ApsClinicNotableFinding,
  type ApsClinicSessionListItem,
  type ApsClinicSessionStats,
  type ApsClinicSessionsResponse,
  type ApsSession,
  apsTierBadgeClass,
  apsTierLabel,
  formatApsDate,
  formatNotableFindingLine,
} from "@/components/admin/performance/apsTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

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

function ComingSoonCard({
  label,
  subtitle,
}: {
  label: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-2xl font-bold text-gray-400">—</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}

function NotableFindingBadges({ finding }: { finding: ApsClinicNotableFinding }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900">
        <Sparkles className="h-3 w-3" aria-hidden />
        Notable asymmetry
      </span>
      {finding.is_outlier ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800">
          <AlertCircle className="h-3 w-3" aria-hidden />
          Outlier pattern
        </span>
      ) : null}
    </div>
  );
}

export default function PerformanceCenterOverviewTab() {
  const { clinicId } = useClinic();
  const [stats, setStats] = useState<ApsClinicSessionStats | null>(null);
  const [recentSessions, setRecentSessions] = useState<ApsClinicSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSession, setSelectedSession] = useState<ApsSession | null>(null);
  const [detailPatientName, setDetailPatientName] = useState("Athlete");
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const loadOverview = useCallback(async () => {
    if (!clinicId) {
      setStats(null);
      setRecentSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const h = await authHeaders();
      const [statsRes, sessionsRes] = await Promise.all([
        fetch(
          `${API_BASE}/aps/sessions?clinic_id=${encodeURIComponent(clinicId)}&limit=0`,
          { headers: h },
        ),
        fetch(
          `${API_BASE}/aps/sessions?clinic_id=${encodeURIComponent(clinicId)}&limit=5&offset=0`,
          { headers: h },
        ),
      ]);

      if (!statsRes.ok) {
        setStats(null);
        setRecentSessions([]);
        setError("Could not load performance overview.");
        return;
      }

      const statsData = (await statsRes.json()) as { stats?: ApsClinicSessionStats };
      setStats(statsData.stats ?? null);

      if (sessionsRes.ok) {
        const sessionsData = (await sessionsRes.json()) as ApsClinicSessionsResponse;
        setRecentSessions(
          Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [],
        );
      } else {
        setRecentSessions([]);
      }
    } catch {
      setStats(null);
      setRecentSessions([]);
      setError("Could not load performance overview.");
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function openSessionDetail(session: ApsClinicSessionListItem) {
    if (!clinicId) return;
    setDetailPatientName(session.patient_name?.trim() || "Athlete");
    setDetailLoading(true);
    setSelectedSession(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/aps/sessions/${encodeURIComponent(session.id)}?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) return;
      const full = (await res.json()) as ApsSession;
      setSelectedSession(full);
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } finally {
      setDetailLoading(false);
    }
  }

  if (selectedSession) {
    return (
      <div ref={detailRef}>
        <ApsSessionDetail
          session={selectedSession}
          patientName={detailPatientName}
          onBack={() => setSelectedSession(null)}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl border border-gray-200 bg-white" />
          <div className="h-72 animate-pulse rounded-xl border border-gray-200 bg-white" />
        </div>
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

  const s: ApsClinicSessionStats = stats ?? {
    total_sessions: 0,
    sessions_this_month: 0,
    distinct_patients: 0,
    tier_counts: EMPTY_APS_TIER_COUNTS,
    notable_findings_count: 0,
    notable_findings: [],
    testing_volume: [],
  };

  const tierCounts = s.tier_counts ?? EMPTY_APS_TIER_COUNTS;
  const notableFindings = s.notable_findings ?? [];
  const notableCount = s.notable_findings_count ?? 0;
  const topNotable = notableFindings[0];
  const testingVolume = s.testing_volume ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-6">
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
          value={String(s.distinct_patients)}
          label="Athletes Tested"
          sub={
            s.distinct_patients === 1
              ? "1 patient with at least one session"
              : `${s.distinct_patients} patients with at least one session`
          }
        />
        <StatCard
          value={String(s.sessions_this_month)}
          label="This Month"
          sub="Sessions with date in the current calendar month"
        />
        <StatCard
          value={String(notableCount)}
          label="Notable Findings"
          sub={
            topNotable
              ? formatNotableFindingLine(topNotable)
              : "No flagged asymmetries clinic-wide yet"
          }
        />
        <ComingSoonCard
          label="Performance Score"
          subtitle="Scoring model in development with Dr. West"
        />
        <ComingSoonCard
          label="Retests Due"
          subtitle="Retest rules pending clinical input"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PerformanceCenterTierDonut counts={tierCounts} />
        <PerformanceCenterTestingVolumeChart data={testingVolume} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className={DS_CARD}>
          <h3 className="text-sm font-semibold text-gray-900">Notable Findings</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Top flagged asymmetries across the clinic (≥15% threshold)
          </p>
          {notableFindings.length === 0 ? (
            <p className="mt-6 py-8 text-center text-sm text-gray-500">
              No notable asymmetries flagged in current sessions.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {notableFindings.map((finding, index) => (
                <li
                  key={`${finding.patient_name}-${finding.test_type}-${finding.metric_name}-${index}`}
                  className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3"
                >
                  <p className="text-sm font-medium text-gray-900">
                    {formatNotableFindingLine(finding)}
                  </p>
                  <div className="mt-2">
                    <NotableFindingBadges finding={finding} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-gray-900">Recent Assessments</h3>
            <p className="mt-0.5 text-xs text-gray-500">Latest Kinvent sessions</p>
          </div>
          <div className={DS_TABLE_WRAP}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className={DS_TABLE_HEAD}>
                  <tr>
                    <th className={DS_TH}>Athlete</th>
                    <th className={DS_TH}>Sport</th>
                    <th className={DS_TH}>Date</th>
                    <th className={DS_TH}>Pattern tier</th>
                    <th className={DS_TH} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {recentSessions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                        No assessments yet.
                      </td>
                    </tr>
                  ) : (
                    recentSessions.map((session) => {
                      const tier = session.session_summary?.overall_tier ?? null;
                      return (
                        <tr key={session.id} className={DS_TR}>
                          <td className={`${DS_TD_PRIMARY} font-medium text-gray-900`}>
                            {session.patient_name?.trim() || "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {session.patient_sport?.trim() || "—"}
                          </td>
                          <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                            {formatApsDate(session.session_date)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <span className={apsTierBadgeClass(tier)}>
                              {apsTierLabel(tier)}
                            </span>
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <button
                              type="button"
                              disabled={detailLoading}
                              className="inline-flex items-center gap-1 text-teal-700 hover:underline disabled:opacity-50"
                              onClick={() => void openSessionDetail(session)}
                            >
                              View
                              <ChevronRight className="h-4 w-4" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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

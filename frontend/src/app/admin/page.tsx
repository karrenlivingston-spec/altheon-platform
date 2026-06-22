"use client";

import { useCallback, useEffect, useState } from "react";

import { DS_PAGE_ROOT, DS_PAGE_SUBTITLE, DS_PAGE_TITLE } from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import { usePermissions } from "@/hooks/usePermissions";
import AriaCard from "@/components/admin/dashboard/AriaCard";
import ClaimsAction from "@/components/admin/dashboard/ClaimsAction";
import ClaimsDonut from "@/components/admin/dashboard/ClaimsDonut";
import CollectionsDonut from "@/components/admin/dashboard/CollectionsDonut";
import RecentActivity from "@/components/admin/dashboard/RecentActivity";
import StatBar from "@/components/admin/dashboard/StatBar";
import TasksAlerts from "@/components/admin/dashboard/TasksAlerts";
import TodaySchedule from "@/components/admin/dashboard/TodaySchedule";
import UpcomingStrip from "@/components/admin/dashboard/UpcomingStrip";
import { DashboardSummary } from "@/components/admin/dashboard/dashboardTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const NY = "America/New_York";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function headerSubtitle(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200 ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="space-y-6 lg:col-span-2">
          <SkeletonBlock className="h-72" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SkeletonBlock className="h-56" />
            <SkeletonBlock className="h-56" />
          </div>
        </div>
        <div className="space-y-6">
          <SkeletonBlock className="h-64" />
          <SkeletonBlock className="h-72" />
        </div>
        <div className="space-y-6">
          <SkeletonBlock className="h-80" />
          <SkeletonBlock className="h-64" />
        </div>
      </div>
      <SkeletonBlock className="mt-6 h-44" />
    </>
  );
}

export default function AdminOverviewPage() {
  const { clinicId, agent_name: agentName } = useClinic();
  const { canViewBilling } = usePermissions();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!clinicId) return;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/dashboard/summary?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: await authHeaders() },
        );
        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as {
            detail?: string;
          } | null;
          throw new Error(
            typeof errJson?.detail === "string"
              ? errJson.detail
              : `Failed to load dashboard (${res.status})`,
          );
        }
        const json = (await res.json()) as DashboardSummary;
        setData(json);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load dashboard");
        if (!opts?.silent) setData(null);
      } finally {
        setLoading(false);
      }
    },
    [clinicId],
  );

  useEffect(() => {
    void fetchSummary();
    const interval = setInterval(() => {
      void fetchSummary({ silent: true });
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchSummary]);

  const showSkeleton = loading && !data;

  return (
    <div className={DS_PAGE_ROOT}>
      <header className="mb-6">
        <h1 className={DS_PAGE_TITLE}>Dashboard</h1>
        <p className={DS_PAGE_SUBTITLE}>{headerSubtitle()}</p>
      </header>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <StatBar data={data} loading={showSkeleton} />

      {showSkeleton ? (
        <DashboardSkeleton />
      ) : data ? (
        <>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
            <div className="space-y-6 lg:col-span-2">
              <TodaySchedule
                rows={data.schedule_today}
                totalToday={data.appointments_today}
              />
              {canViewBilling ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <CollectionsDonut data={data} />
                  <ClaimsDonut data={data} />
                </div>
              ) : null}
            </div>

            <div className="space-y-6">
              <TasksAlerts data={data} onRefresh={() => void fetchSummary({ silent: true })} />
              {canViewBilling ? <ClaimsAction data={data} /> : null}
            </div>

            <div className="space-y-6">
              <AriaCard data={data} agentName={agentName} />
              <RecentActivity items={data.recent_activity} />
            </div>
          </div>

          <div className="mt-6">
            <UpcomingStrip rows={data.upcoming_appointments} />
          </div>
        </>
      ) : null}
    </div>
  );
}

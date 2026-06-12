"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { DS_PAGE_ROOT, DS_PAGE_SUBTITLE, DS_PAGE_TITLE } from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
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
  const line = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  return line;
}

export default function AdminOverviewPage() {
  const { clinicId, agent_name: agentName } = useClinic();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!clinicId) return;
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
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    setLoading(true);
    void fetchSummary();
    const interval = setInterval(() => {
      void fetchSummary();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchSummary]);

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

      <StatBar data={data} loading={loading} />

      {loading && !data ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading dashboard…
        </div>
      ) : data ? (
        <>
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
            <div className="space-y-6 lg:col-span-2">
              <TodaySchedule
                rows={data.schedule_today}
                totalToday={data.appointments_today}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CollectionsDonut data={data} />
                <ClaimsDonut data={data} />
              </div>
            </div>

            <div className="space-y-6">
              <TasksAlerts data={data} />
              <ClaimsAction data={data} />
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

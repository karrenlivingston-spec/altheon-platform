"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Phone, Settings } from "lucide-react";

import { getEasternYMD } from "@/components/adminEastern";
import {
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import VoiceAgentAriaCard from "@/components/admin/voice-agent/VoiceAgentAriaCard";
import VoiceAgentCallVolumeChart from "@/components/admin/voice-agent/VoiceAgentCallVolumeChart";
import VoiceAgentOutcomesDonut from "@/components/admin/voice-agent/VoiceAgentOutcomesDonut";
import VoiceAgentRecentCallsTable from "@/components/admin/voice-agent/VoiceAgentRecentCallsTable";
import VoiceAgentSidebar from "@/components/admin/voice-agent/VoiceAgentSidebar";
import VoiceAgentStatCards from "@/components/admin/voice-agent/VoiceAgentStatCards";
import {
  CallVolumePoint,
  RecentCall,
  TopCallReason,
  VoiceAgentStats,
  VoiceOutcomes,
  VoicePerformance,
} from "@/components/admin/voice-agent/voiceAgentTypes";
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

export default function AdminVoiceAgentPage() {
  const { clinicId } = useClinic();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<VoiceAgentStats | null>(null);
  const [volume, setVolume] = useState<CallVolumePoint[]>([]);
  const [outcomes, setOutcomes] = useState<VoiceOutcomes | null>(null);
  const [calls, setCalls] = useState<RecentCall[]>([]);
  const [reasons, setReasons] = useState<TopCallReason[]>([]);
  const [performance, setPerformance] = useState<VoicePerformance | null>(null);
  const [volumeDays, setVolumeDays] = useState(7);

  const loadDashboard = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    const today = getEasternYMD(new Date());
    const headers = await authHeaders();
    const q = encodeURIComponent(clinicId);
    try {
      const [
        statsRes,
        volumeRes,
        outcomesRes,
        callsRes,
        reasonsRes,
        perfRes,
      ] = await Promise.all([
        fetch(
          `${API_BASE}/api/voice-agent/stats?clinic_id=${q}&date=${today}`,
          { headers },
        ),
        fetch(
          `${API_BASE}/api/voice-agent/call-volume?clinic_id=${q}&days=${volumeDays}`,
          { headers },
        ),
        fetch(
          `${API_BASE}/api/voice-agent/outcomes?clinic_id=${q}&days=7`,
          { headers },
        ),
        fetch(
          `${API_BASE}/api/voice-agent/recent-calls?clinic_id=${q}&limit=20`,
          { headers },
        ),
        fetch(
          `${API_BASE}/api/voice-agent/top-reasons?clinic_id=${q}&days=7`,
          { headers },
        ),
        fetch(
          `${API_BASE}/api/voice-agent/performance?clinic_id=${q}&days=7`,
          { headers },
        ),
      ]);

      if (statsRes.ok) setStats((await statsRes.json()) as VoiceAgentStats);
      if (volumeRes.ok) setVolume((await volumeRes.json()) as CallVolumePoint[]);
      if (outcomesRes.ok) setOutcomes((await outcomesRes.json()) as VoiceOutcomes);
      if (callsRes.ok) setCalls((await callsRes.json()) as RecentCall[]);
      if (reasonsRes.ok) setReasons((await reasonsRes.json()) as TopCallReason[]);
      if (perfRes.ok) setPerformance((await perfRes.json()) as VoicePerformance);

      if (!statsRes.ok && !callsRes.ok) {
        setError("Could not load voice agent dashboard.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [clinicId, volumeDays]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleVolumeDaysChange = (days: number) => {
    setVolumeDays(days);
  };

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Voice Agent</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Inbound call management and activity
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/settings" className={DS_SECONDARY_BTN}>
            <Settings className="mr-1.5 inline h-4 w-4" />
            Agent Settings
          </Link>
          <a href="#recent-calls" className={DS_SECONDARY_BTN}>
            <Phone className="mr-1.5 inline h-4 w-4" />
            Call Log
          </a>
          <span className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
            Aria is Online
          </span>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-7">
        <VoiceAgentAriaCard isOnline={stats?.is_online ?? true} />
        <VoiceAgentStatCards stats={stats} loading={loading} />
      </div>

      <div className="mt-6 flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-6 xl:w-3/4">
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <VoiceAgentCallVolumeChart
                data={volume}
                days={volumeDays}
                onDaysChange={handleVolumeDaysChange}
                loading={loading}
              />
            </div>
            <div className="lg:col-span-2">
              <VoiceAgentOutcomesDonut outcomes={outcomes} loading={loading} />
            </div>
          </div>

          <VoiceAgentRecentCallsTable calls={calls} loading={loading} />
        </div>

        <div className="w-full shrink-0 xl:w-1/4">
          <VoiceAgentSidebar
            reasons={reasons}
            performance={performance}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}

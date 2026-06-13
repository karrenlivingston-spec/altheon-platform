"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Scale } from "lucide-react";

import {
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import RecordsGenerateWizard from "@/components/admin/records/RecordsGenerateWizard";
import RecordsRecentExportsTable from "@/components/admin/records/RecordsRecentExportsTable";
import RecordsSidebar from "@/components/admin/records/RecordsSidebar";
import RecordsStatCards from "@/components/admin/records/RecordsStatCards";
import {
  AttorneyRequest,
  RecentExport,
  RecordsStats,
  TypeBreakdown,
} from "@/components/admin/records/recordsTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export default function AdminRecordsPage() {
  const { clinicId } = useClinic();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<RecordsStats | null>(null);
  const [exports, setExports] = useState<RecentExport[]>([]);
  const [attorneyRequests, setAttorneyRequests] = useState<AttorneyRequest[]>([]);
  const [typeBreakdown, setTypeBreakdown] = useState<TypeBreakdown | null>(null);
  const [generating, setGenerating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showGenerateMenu, setShowGenerateMenu] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    const headers = await authHeaders();
    const q = encodeURIComponent(clinicId);
    try {
      const [statsRes, exportsRes, requestsRes, breakdownRes] = await Promise.all([
        fetch(`${API_BASE}/api/records/stats?clinic_id=${q}`, { headers }),
        fetch(`${API_BASE}/api/records/recent-exports?clinic_id=${q}&limit=5`, {
          headers,
        }),
        fetch(`${API_BASE}/api/records/attorney-requests?clinic_id=${q}&limit=5`, {
          headers,
        }),
        fetch(`${API_BASE}/api/records/type-breakdown?clinic_id=${q}`, { headers }),
      ]);

      if (statsRes.ok) setStats((await statsRes.json()) as RecordsStats);
      if (exportsRes.ok) setExports((await exportsRes.json()) as RecentExport[]);
      if (requestsRes.ok) {
        setAttorneyRequests((await requestsRes.json()) as AttorneyRequest[]);
      }
      if (breakdownRes.ok) {
        setTypeBreakdown((await breakdownRes.json()) as TypeBreakdown);
      }
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleGenerate(payload: {
    patient_id: string;
    record_types: string[];
    date_from: string;
    date_to: string;
    recipient_email?: string;
    legal_request_id?: string;
  }) {
    setGenerating(true);
    setSuccessMessage(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/records/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          clinic_id: clinicId,
          ...payload,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as RecentExport & {
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(json.detail || "Generate failed");
      }
      const msg = json.file_url
        ? `Records packet created. Download ready.`
        : `Records packet queued (status: ${json.status || "processing"}).`;
      setSuccessMessage(msg);
      if (json.file_url) {
        window.open(json.file_url, "_blank");
      }
      void loadDashboard();
    } catch (e) {
      setSuccessMessage(e instanceof Error ? e.message : "Failed to generate records");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Records Center</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Search, generate, and share clinical records and documents.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/legal-requests" className={`${DS_SECONDARY_BTN} relative`}>
            <Scale className="mr-1.5 inline h-4 w-4" />
            Attorney Requests
            {stats && stats.pending_requests > 0 ? (
              <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                {stats.pending_requests}
              </span>
            ) : null}
          </Link>
          <div className="relative">
            <button
              type="button"
              className={DS_PRIMARY_BTN}
              onClick={() => setShowGenerateMenu(!showGenerateMenu)}
            >
              + Generate Records
              <ChevronDown className="ml-1 inline h-4 w-4" />
            </button>
            {showGenerateMenu ? (
              <div className="absolute right-0 z-20 mt-1 min-w-[200px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setShowGenerateMenu(false);
                    document
                      .getElementById("records-wizard")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  New Records Packet
                </button>
                <a
                  href="#recent-exports"
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setShowGenerateMenu(false)}
                >
                  View Recent Exports
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <RecordsStatCards stats={stats} loading={loading} />
      </div>

      <div className="mt-6 flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-6 xl:w-[65%]">
          <div id="records-wizard">
            <RecordsGenerateWizard
              clinicId={clinicId}
              attorneyRequests={attorneyRequests}
              onGenerate={handleGenerate}
              generating={generating}
              successMessage={successMessage}
            />
          </div>

          <div id="recent-exports">
            <RecordsRecentExportsTable exports={exports} loading={loading} />
          </div>
        </div>

        <div className="w-full shrink-0 xl:w-[35%]">
          <RecordsSidebar
            attorneyRequests={attorneyRequests.slice(0, 3)}
            typeBreakdown={typeBreakdown}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, Upload } from "lucide-react";

import {
  DS_CARD,
  DS_PRIMARY_BTN,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";
import { ApsSessionDetail } from "@/components/admin/performance/ApsSessionDetail";
import UploadApsReportModal from "@/components/admin/performance/UploadApsReportModal";
import {
  type ApsSession,
  apsTierBadgeClass,
  apsTierLabel,
  formatApsDate,
} from "@/components/admin/performance/apsTypes";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type PatientPerformanceTabProps = {
  patientId: string;
  clinicId: string;
  patientName: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function PatientPerformanceTab({
  patientId,
  clinicId,
  patientName,
}: PatientPerformanceTabProps) {
  const [sessions, setSessions] = useState<ApsSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<ApsSession | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/aps/patients/${encodeURIComponent(patientId)}/sessions?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) {
        setError("Could not load performance assessments.");
        setSessions([]);
        return;
      }
      const data = (await res.json()) as ApsSession[];
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setError("Could not load performance assessments.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  function openSession(session: ApsSession) {
    setSelectedSession(session);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleUploadSuccess(session: ApsSession) {
    setSessions((prev) => {
      const next = [session, ...prev.filter((s) => s.id !== session.id)];
      return next.sort(
        (a, b) =>
          new Date(b.session_date).getTime() - new Date(a.session_date).getTime(),
      );
    });
    setToast("Report analyzed — review suggested confirmatory tests below.");
    setSelectedSession(session);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  if (selectedSession) {
    return (
      <div ref={detailRef}>
        {toast ? (
          <div
            className="mb-4 rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900"
            role="status"
          >
            {toast}
          </div>
        ) : null}
        <ApsSessionDetail
          session={selectedSession}
          patientName={patientName}
          onBack={() => setSelectedSession(null)}
        />
        <UploadApsReportModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onSuccess={handleUploadSuccess}
          context={{ patientId, patientName, clinicId }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {toast ? (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
            Performance assessments
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Upload Kinvent force-plate reports to highlight asymmetry patterns and suggest
            confirmatory tests. Results are recommendations only — not diagnoses.
          </p>
        </div>
        <button
          type="button"
          className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2`}
          onClick={() => setUploadOpen(true)}
        >
          <Upload className="h-4 w-4" aria-hidden />
          Upload Report
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className={`${DS_CARD} flex items-center justify-center gap-2 py-12 text-gray-500`}>
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading assessments…
        </div>
      ) : sessions.length === 0 ? (
        <div className={`${DS_CARD} py-12 text-center`}>
          <p className="text-base font-medium text-gray-900">
            No performance assessments yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
            Upload a Kinvent Smart Mode PDF to see asymmetry patterns and suggested next
            confirmatory tests for this patient.
          </p>
          <button
            type="button"
            className={`${DS_PRIMARY_BTN} mt-6 inline-flex items-center gap-2`}
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="h-4 w-4" aria-hidden />
            Upload Report
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {sessions.map((session) => {
            const tier = session.session_summary?.overall_tier ?? null;
            const notableCount =
              session.session_summary?.total_notable_findings ??
              (session.findings ?? []).filter((f) => f.is_notable).length;
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => openSession(session)}
                  className={`${DS_CARD} flex w-full items-center justify-between gap-4 text-left transition-shadow hover:shadow-md`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {formatApsDate(session.session_date)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {notableCount} notable finding{notableCount === 1 ? "" : "s"}
                      {session.source_filename
                        ? ` · ${session.source_filename}`
                        : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={apsTierBadgeClass(tier)}>{apsTierLabel(tier)}</span>
                    <ChevronRight className="h-5 w-5 text-gray-400" aria-hidden />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <UploadApsReportModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={handleUploadSuccess}
        context={{ patientId, patientName, clinicId }}
      />
    </div>
  );
}

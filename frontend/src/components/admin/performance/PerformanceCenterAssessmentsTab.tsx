"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, Upload, X } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import { ApsSessionDetail } from "@/components/admin/performance/ApsSessionDetail";
import UploadApsReportModal, {
  type UploadApsContext,
} from "@/components/admin/performance/UploadApsReportModal";
import {
  type ApsClinicSessionListItem,
  type ApsClinicSessionsResponse,
  type ApsSession,
  apsTierBadgeClass,
  apsTierLabel,
  formatApsDate,
} from "@/components/admin/performance/apsTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const PAGE_SIZE = 20;

type PatientOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function patientLabel(p: PatientOption): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown patient";
}

export default function PerformanceCenterAssessmentsTab() {
  const { clinicId } = useClinic();
  const [sessions, setSessions] = useState<ApsClinicSessionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [patientSearchBusy, setPatientSearchBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadContext, setUploadContext] = useState<UploadApsContext | null>(null);

  const [selectedSession, setSelectedSession] = useState<ApsSession | null>(null);
  const [detailPatientName, setDetailPatientName] = useState("Athlete");
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    if (!clinicId) {
      setSessions([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const h = await authHeaders();
      const params = new URLSearchParams({
        clinic_id: clinicId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`${API_BASE}/aps/sessions?${params.toString()}`, {
        headers: h,
      });
      if (!res.ok) {
        setSessions([]);
        setTotal(0);
        setError("Could not load assessments.");
        return;
      }
      const data = (await res.json()) as ApsClinicSessionsResponse;
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch {
      setSessions([]);
      setTotal(0);
      setError("Could not load assessments.");
    } finally {
      setLoading(false);
    }
  }, [clinicId, offset]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!patientPickerOpen || !clinicId) return;
    setPatientSearchBusy(true);
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ clinic_id: clinicId });
          if (patientQuery.trim()) params.set("search", patientQuery.trim());
          const res = await fetch(`${API_BASE}/patients?${params.toString()}`, {
            headers: await authHeaders(),
          });
          const rows = res.ok ? await res.json() : [];
          setPatientResults(Array.isArray(rows) ? rows : []);
        } catch {
          setPatientResults([]);
        } finally {
          setPatientSearchBusy(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(t);
  }, [patientPickerOpen, patientQuery, clinicId]);

  useEffect(() => {
    if (!patientPickerOpen) return;
    function onDocClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [patientPickerOpen]);

  function openImportFlow() {
    setPatientQuery("");
    setPatientResults([]);
    setPatientPickerOpen(true);
  }

  function selectPatientForUpload(p: PatientOption) {
    if (!clinicId) return;
    setPatientPickerOpen(false);
    setUploadContext({
      patientId: p.id,
      patientName: patientLabel(p),
      clinicId,
    });
    setUploadOpen(true);
  }

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
      if (!res.ok) {
        setToast("Could not load session detail.");
        return;
      }
      const full = (await res.json()) as ApsSession;
      setSelectedSession(full);
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setToast("Could not load session detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  function handleUploadSuccess(session: ApsSession) {
    setOffset(0);
    void loadSessions();
    setDetailPatientName(uploadContext?.patientName ?? "Athlete");
    setToast("Report analyzed — review suggested confirmatory tests below.");
    setSelectedSession(session);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const showPagination = total > PAGE_SIZE;

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
          patientName={detailPatientName}
          onBack={() => setSelectedSession(null)}
        />
        <UploadApsReportModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onSuccess={handleUploadSuccess}
          context={uploadContext}
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Assessments</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Kinvent force-plate sessions across all athletes in your clinic. Select a
            patient before importing a new PDF.
          </p>
        </div>
        <button
          type="button"
          className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2`}
          onClick={openImportFlow}
        >
          <Upload className="h-4 w-4" aria-hidden />
          Import Kinvent PDF
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

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
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Loading assessments…
                    </span>
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    <p className="font-medium text-gray-900">No assessments yet</p>
                    <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
                      Import a Kinvent Smart Mode PDF to analyze jump-test data for an
                      athlete.
                    </p>
                    <button
                      type="button"
                      className={`${DS_PRIMARY_BTN} mt-4 inline-flex items-center gap-2`}
                      onClick={openImportFlow}
                    >
                      <Upload className="h-4 w-4" aria-hidden />
                      Import Kinvent PDF
                    </button>
                  </td>
                </tr>
              ) : (
                sessions.map((session) => {
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

      {!loading && total > 0 ? (
        <p className="text-sm text-gray-600">
          {total === 1 ? "1 assessment" : `${total} assessments`}
          {showPagination
            ? ` · Page ${currentPage} of ${pageCount}`
            : null}
        </p>
      ) : null}

      {showPagination ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      ) : null}

      {patientPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`${DS_CARD} w-full max-w-md p-6`} ref={pickerRef}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Select athlete</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Choose the patient this Kinvent report belongs to.
                </p>
              </div>
              <button
                type="button"
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
                onClick={() => setPatientPickerOpen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-4 block text-sm font-medium text-gray-700">
              Search patients
              <input
                type="text"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                className={`mt-1 block w-full ${DS_INPUT}`}
                placeholder="Type a name…"
                autoFocus
              />
            </label>
            <ul className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-gray-200">
              {patientSearchBusy ? (
                <li className="px-4 py-6 text-center text-sm text-gray-500">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                </li>
              ) : patientResults.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-gray-500">
                  No patients found.
                </li>
              ) : (
                patientResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="block w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50"
                      onClick={() => selectPatientForUpload(p)}
                    >
                      {patientLabel(p)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      <UploadApsReportModal
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          setUploadContext(null);
        }}
        onSuccess={handleUploadSuccess}
        context={uploadContext}
      />
    </div>
  );
}

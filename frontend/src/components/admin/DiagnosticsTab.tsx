"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Upload,
} from "lucide-react";

import {
  DS_CARD,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const SOAP_STORAGE_KEY = "altheon:soap-prefill";
const MAX_BYTES = 20 * 1024 * 1024;

const DOC_TYPES = [
  { value: "mri_report", label: "MRI Report" },
  { value: "xray", label: "X-ray" },
  { value: "pdf_report", label: "PDF Report" },
  { value: "photo", label: "Photo" },
  { value: "prescription", label: "Prescription" },
  { value: "insurance_card", label: "Insurance Card" },
  { value: "id_document", label: "ID Document" },
  { value: "other", label: "Other" },
] as const;

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp";

type SoapSuggestions = {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
};

type DiagnosticRow = {
  id: string;
  document_id?: string;
  clinician_summary?: string | null;
  patient_explanation?: string | null;
  red_flags?: string[] | null;
  soap_suggestions?: SoapSuggestions | null;
  imaging_date?: string | null;
  body_part?: string | null;
  modality?: string | null;
  status?: string | null;
  created_at?: string | null;
  patient_documents?: { file_name?: string; document_type?: string } | null;
};

type TimelineRow = {
  id: string;
  event_date?: string;
  summary?: string | null;
  diagnostic_analyses?: {
    modality?: string | null;
    body_part?: string | null;
  } | null;
};

async function authHeaders(
  json = false,
): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "reviewed") return "bg-emerald-100 text-emerald-800";
  if (s === "pending") return "bg-amber-100 text-amber-900";
  return "bg-slate-100 text-slate-700";
}

function statusLabel(status: string, hasSummary: boolean): string {
  const s = status.toLowerCase();
  if (s === "reviewed") return "Reviewed";
  if (s === "pending" && !hasSummary) return "Analyzing…";
  if (s === "pending") return "Pending Review";
  return "Analyzed";
}

function copySoapToNote(soap: SoapSuggestions) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SOAP_STORAGE_KEY, JSON.stringify(soap));
  window.dispatchEvent(
    new CustomEvent("altheon:soap-prefill", { detail: soap }),
  );
}

function isStillAnalyzing(row: DiagnosticRow): boolean {
  const st = (row.status ?? "").toLowerCase();
  const hasSummary = Boolean((row.clinician_summary ?? "").trim());
  return st === "pending" && !hasSummary;
}

function uploadWithProgress(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  onProgress: (pct: number) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      const body = xhr.responseText;
      resolve(
        new Response(body, {
          status: xhr.status,
          statusText: xhr.statusText,
        }),
      );
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(form);
  });
}

type Props = {
  patientId: string;
  clinicId: string;
};

export function DiagnosticsTab({ patientId, clinicId }: Props) {
  const [documentType, setDocumentType] = useState<string>("mri_report");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<DiagnosticRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzingDocIds, setAnalyzingDocIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [rerunningDocIds, setRerunningDocIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedClinician, setExpandedClinician] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedPatient, setExpandedPatient] = useState<Set<string>>(
    () => new Set(),
  );
  const [toast, setToast] = useState<string | null>(null);
  const [sendLinkBusy, setSendLinkBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = useCallback(async () => {
    try {
      const h = await authHeaders();
      const [diagRes, tlRes] = await Promise.all([
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/diagnostics?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/imaging-timeline?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
      ]);
      if (diagRes.ok) {
        const rows = (await diagRes.json()) as DiagnosticRow[];
        setAnalyses(Array.isArray(rows) ? rows : []);
      }
      if (tlRes.ok) {
        const rows = (await tlRes.json()) as TimelineRow[];
        setTimeline(Array.isArray(rows) ? rows : []);
      }
    } finally {
      setLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    void loadData();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const startAnalysisPolling = useCallback(
    (documentId: string, mode: "upload" | "rerun") => {
      if (mode === "upload") {
        setAnalyzingDocIds((prev) => new Set(prev).add(documentId));
      } else {
        setRerunningDocIds((prev) => new Set(prev).add(documentId));
      }

      if (pollRef.current) clearInterval(pollRef.current);
      let attempts = 0;
      pollRef.current = setInterval(() => {
        attempts += 1;
        void loadData();
        if (attempts >= 60) {
          setAnalyzingDocIds((prev) => {
            const n = new Set(prev);
            n.delete(documentId);
            return n;
          });
          setRerunningDocIds((prev) => {
            const n = new Set(prev);
            n.delete(documentId);
            return n;
          });
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      }, 2500);
    },
    [loadData],
  );

  useEffect(() => {
    const checkComplete = (docId: string, rows: DiagnosticRow[]) => {
      const row = rows.find((a) => a.document_id === docId);
      return row && (row.clinician_summary ?? "").trim().length > 0;
    };

    setAnalyzingDocIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        if (checkComplete(id, analyses)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setRerunningDocIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        if (checkComplete(id, analyses)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    if (analyzingDocIds.size === 0 && rerunningDocIds.size === 0 && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [analyses, analyzingDocIds.size, rerunningDocIds.size]);

  async function uploadFile(file: File) {
    if (file.size > MAX_BYTES) {
      setUploadError("File exceeds 20MB limit.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      const h = await authHeaders();
      const form = new FormData();
      form.append("file", file);
      form.append("document_type", documentType);
      form.append("upload_source", "receptionist");

      const url = `${API_BASE}/patients/${encodeURIComponent(patientId)}/documents/upload?clinic_id=${encodeURIComponent(clinicId)}`;
      const res = await uploadWithProgress(url, form, h, setUploadProgress);

      if (!res.ok) {
        throw new Error((await res.text().catch(() => "")).trim() || "Upload failed");
      }
      const data = (await res.json()) as { document_id?: string };
      if (data.document_id) {
        startAnalysisPolling(data.document_id, "upload");
      }
      await loadData();
      setToast("Document uploaded — analysis in progress");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  async function rerunAnalysis(documentId: string) {
    const h = await authHeaders();
    const res = await fetch(
      `${API_BASE}/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}/analyze?clinic_id=${encodeURIComponent(clinicId)}`,
      { method: "POST", headers: h },
    );
    if (!res.ok) {
      setToast("Re-analysis failed");
      return;
    }
    startAnalysisPolling(documentId, "rerun");
    setToast("Re-running analysis…");
  }

  async function sendUploadLink() {
    setSendLinkBusy(true);
    try {
      const h = await authHeaders(true);
      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}/documents/send-upload-link?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: "POST", headers: h, body: "{}" },
      );
      if (!res.ok) {
        setToast("Could not send upload link");
        return;
      }
      setToast("Upload link sent via SMS");
    } finally {
      setSendLinkBusy(false);
    }
  }

  async function markReviewed(analysisId: string) {
    const h = await authHeaders(true);
    await fetch(
      `${API_BASE}/patients/${encodeURIComponent(patientId)}/diagnostics/${encodeURIComponent(analysisId)}/review?clinic_id=${encodeURIComponent(clinicId)}`,
      { method: "PATCH", headers: h, body: "{}" },
    );
    await loadData();
  }

  const orphanAnalyzing = [...analyzingDocIds].filter(
    (id) => !analyses.some((a) => a.document_id === id),
  );

  return (
    <div className="space-y-8">
      {toast ? (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      <div className={`${DS_CARD} p-6`}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
            Upload document
          </h2>
          <button
            type="button"
            disabled={sendLinkBusy}
            onClick={() => void sendUploadLink()}
            className={`${DS_SECONDARY_BTN} text-sm disabled:opacity-60`}
          >
            {sendLinkBusy ? "Sending…" : "Send Upload Link to Patient"}
          </button>
        </div>

        <label className="mb-3 block text-sm font-medium text-gray-700">
          Document type
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="mt-1 block h-9 w-full max-w-xs rounded-lg border border-gray-200 px-3 text-sm"
          >
            {DOC_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-teal-200 bg-teal-50/40 px-6 py-8 text-center transition-colors hover:border-teal-400"
          onClick={() => !uploading && fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <div className="w-full max-w-xs">
              <div className="mb-2 flex items-center justify-center gap-2 text-sm text-teal-800">
                <Loader2 className="h-5 w-5 animate-spin" />
                Uploading… {uploadProgress}%
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-teal-100">
                <div
                  className="h-full bg-teal-600 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <Upload className="mb-2 h-8 w-8 text-teal-600" />
              <p className="text-sm font-medium text-gray-800">
                Drag and drop or click to upload
              </p>
              <p className="mt-1 text-xs text-gray-500">
                PDF, JPG, PNG, HEIC, WEBP — max 20MB
              </p>
            </>
          )}
        </div>
        {uploadError ? (
          <p className="mt-2 text-sm text-red-600">{uploadError}</p>
        ) : null}
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-900">
          Diagnostic analyses
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : analyses.length === 0 && orphanAnalyzing.length === 0 ? (
          <p className="text-sm text-gray-500">
            No analyses yet. Upload a document to begin.
          </p>
        ) : (
          <div className="space-y-4">
            {orphanAnalyzing.map((docId) => (
              <div
                key={`analyzing-${docId}`}
                className={`${DS_CARD} flex items-center gap-3 p-5 text-sm text-gray-600`}
              >
                <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
                Analyzing…
              </div>
            ))}
            {analyses.map((row) => {
              const flags = Array.isArray(row.red_flags) ? row.red_flags : [];
              const soap = (row.soap_suggestions ?? {}) as SoapSuggestions;
              const st = row.status ?? "analyzed";
              const hasSummary = Boolean((row.clinician_summary ?? "").trim());
              const docId = row.document_id ?? "";
              const analyzing =
                isStillAnalyzing(row) ||
                (docId && analyzingDocIds.has(docId)) ||
                (docId && rerunningDocIds.has(docId));
              const showClin = expandedClinician.has(row.id);
              const showPat = expandedPatient.has(row.id);

              if (analyzing && !hasSummary) {
                return (
                  <div
                    key={row.id}
                    className={`${DS_CARD} flex items-center gap-3 p-5 text-sm text-gray-600`}
                  >
                    <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
                    Analyzing…
                  </div>
                );
              }

              return (
                <div key={row.id} className={`${DS_CARD} p-5`}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {row.modality ? (
                      <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                        {row.modality}
                      </span>
                    ) : null}
                    {row.body_part ? (
                      <span className="text-sm font-medium text-gray-800">
                        {row.body_part}
                      </span>
                    ) : null}
                    {row.imaging_date ? (
                      <span className="text-sm text-gray-500">
                        {row.imaging_date}
                      </span>
                    ) : null}
                    <span
                      className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(st)}`}
                    >
                      {statusLabel(st, hasSummary)}
                    </span>
                  </div>

                  {flags.length > 0 ? (
                    <ul className="mb-3 space-y-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      {flags.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <AlertTriangle
                            className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                            aria-hidden
                          />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <button
                    type="button"
                    className="mb-2 flex w-full items-center gap-1 text-left text-sm font-semibold text-gray-900"
                    onClick={() =>
                      setExpandedClinician((s) => {
                        const n = new Set(s);
                        if (n.has(row.id)) n.delete(row.id);
                        else n.add(row.id);
                        return n;
                      })
                    }
                  >
                    {showClin ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Clinician Summary
                  </button>
                  {showClin ? (
                    <p className="mb-3 whitespace-pre-wrap rounded-md border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800">
                      {row.clinician_summary || "—"}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    className="mb-2 flex w-full items-center gap-1 text-left text-sm font-semibold text-slate-600"
                    onClick={() =>
                      setExpandedPatient((s) => {
                        const n = new Set(s);
                        if (n.has(row.id)) n.delete(row.id);
                        else n.add(row.id);
                        return n;
                      })
                    }
                  >
                    {showPat ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Patient Explanation
                  </button>
                  {showPat ? (
                    <p className="mb-3 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50/90 px-3 py-2 text-sm leading-relaxed text-slate-600">
                      {row.patient_explanation || "—"}
                    </p>
                  ) : null}

                  <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/80 p-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      SOAP Suggestions
                    </h3>
                    <div className="grid gap-3 text-sm">
                      {(
                        [
                          ["S", "subjective"],
                          ["O", "objective"],
                          ["A", "assessment"],
                          ["P", "plan"],
                        ] as const
                      ).map(([label, key]) => (
                        <div key={key}>
                          <span className="font-semibold text-gray-800">
                            {label}:{" "}
                          </span>
                          <span className="text-gray-600">
                            {(soap[key] ?? "").trim() || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`${DS_SECONDARY_BTN} text-xs`}
                        onClick={() => {
                          copySoapToNote(soap);
                          setToast(
                            "SOAP suggestions copied — open Clinical Notes to apply",
                          );
                        }}
                      >
                        Copy to Current Note
                      </button>
                      {docId ? (
                        <button
                          type="button"
                          className={`${DS_SECONDARY_BTN} text-xs`}
                          disabled={rerunningDocIds.has(docId)}
                          onClick={() => void rerunAnalysis(docId)}
                        >
                          {rerunningDocIds.has(docId)
                            ? "Re-running…"
                            : "Re-run Analysis"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {st === "pending" && flags.length > 0 ? (
                    <button
                      type="button"
                      className={`${DS_PRIMARY_BTN} mt-4`}
                      onClick={() => void markReviewed(row.id)}
                    >
                      Mark as Reviewed
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-900">
          Imaging timeline
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-500">No imaging events yet.</p>
        ) : (
          <div className="relative border-l-2 border-teal-200 pl-6">
            {timeline.map((ev) => {
              const da = ev.diagnostic_analyses;
              const parts = [
                ev.event_date ?? "—",
                da?.modality,
                da?.body_part,
                (ev.summary ?? "").trim(),
              ].filter(Boolean);
              return (
                <div key={ev.id} className="relative mb-6 last:mb-0">
                  <span className="absolute -left-[1.65rem] top-1.5 h-3 w-3 rounded-full bg-teal-500" />
                  <p className="text-sm text-gray-800">
                    {parts.join(" | ")}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

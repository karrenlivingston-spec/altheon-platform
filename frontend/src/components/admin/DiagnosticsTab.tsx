"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Upload } from "lucide-react";

import {
  DS_CARD,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const DOC_TYPES = [
  { value: "mri_report", label: "MRI Report" },
  { value: "xray", label: "X-ray" },
  { value: "pdf_report", label: "PDF Report" },
  { value: "photo", label: "Photo" },
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

function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "reviewed") return "Reviewed";
  if (s === "pending") return "Pending Review";
  return "Analyzed";
}

function copySoapToNote(soap: SoapSuggestions) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem("altheon_soap_prefill", JSON.stringify(soap));
  window.dispatchEvent(
    new CustomEvent("altheon:soap-prefill", { detail: soap }),
  );
}

type Props = {
  patientId: string;
  clinicId: string;
};

export function DiagnosticsTab({ patientId, clinicId }: Props) {
  const [documentType, setDocumentType] = useState<string>("mri_report");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<DiagnosticRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [expandedClinician, setExpandedClinician] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedPatient, setExpandedPatient] = useState<Set<string>>(
    () => new Set(),
  );
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

  function startPolling(documentId: string) {
    setAnalyzingIds((prev) => new Set(prev).add(documentId));
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(() => {
      attempts += 1;
      void loadData();
      if (attempts >= 48) {
        setAnalyzingIds((prev) => {
          const next = new Set(prev);
          next.delete(documentId);
          return next;
        });
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 2500);
  }

  useEffect(() => {
    if (analyzingIds.size === 0) return;
    const done = [...analyzingIds].filter((docId) =>
      analyses.some((a) => a.document_id === docId),
    );
    if (done.length === 0) return;
    setAnalyzingIds((prev) => {
      const next = new Set(prev);
      done.forEach((id) => next.delete(id));
      return next;
    });
    if ([...analyzingIds].every((id) => analyses.some((a) => a.document_id === id))) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [analyses, analyzingIds]);

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const h = await authHeaders();
      const form = new FormData();
      form.append("file", file);
      form.append("document_type", documentType);
      form.append("upload_source", "receptionist");

      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}/documents/upload?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: "POST", headers: h, body: form },
      );
      if (!res.ok) {
        throw new Error((await res.text().catch(() => "")).trim() || "Upload failed");
      }
      const data = (await res.json()) as { document_id?: string };
      if (data.document_id) startPolling(data.document_id);
      await loadData();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  async function markReviewed(analysisId: string) {
    const h = await authHeaders(true);
    await fetch(
      `${API_BASE}/patients/${encodeURIComponent(patientId)}/diagnostics/${encodeURIComponent(analysisId)}/review?clinic_id=${encodeURIComponent(clinicId)}`,
      { method: "PATCH", headers: h, body: "{}" },
    );
    await loadData();
  }

  const pendingDocIds = new Set(analyses.map((a) => a.document_id).filter(Boolean));

  return (
    <div className="space-y-8">
      <div className={`${DS_CARD} p-6`}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-900">
          Upload document
        </h2>
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
          onClick={() => fileInputRef.current?.click()}
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
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <div className="flex items-center gap-2 text-sm text-teal-800">
              <Loader2 className="h-5 w-5 animate-spin" />
              Uploading &amp; analyzing…
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
        ) : analyses.length === 0 && analyzingIds.size === 0 ? (
          <p className="text-sm text-gray-500">No analyses yet. Upload a document to begin.</p>
        ) : (
          <div className="space-y-4">
            {[...analyzingIds]
              .filter((id) => !pendingDocIds.has(id))
              .map((docId) => (
                <div
                  key={`analyzing-${docId}`}
                  className={`${DS_CARD} flex items-center gap-3 p-5 text-sm text-gray-600`}
                >
                  <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
                  Analyzing document…
                </div>
              ))}
            {analyses.map((row) => {
              const flags = Array.isArray(row.red_flags) ? row.red_flags : [];
              const soap = (row.soap_suggestions ?? {}) as SoapSuggestions;
              const st = row.status ?? "analyzed";
              const showClin = expandedClinician.has(row.id);
              const showPat = expandedPatient.has(row.id);

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
                      <span className="text-sm text-gray-500">{row.imaging_date}</span>
                    ) : null}
                    <span
                      className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(st)}`}
                    >
                      {statusLabel(st)}
                    </span>
                  </div>

                  {flags.length > 0 ? (
                    <ul className="mb-3 space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      {flags.map((f) => (
                        <li key={f}>• {f}</li>
                      ))}
                    </ul>
                  ) : null}

                  <button
                    type="button"
                    className="mb-2 flex w-full items-center gap-1 text-left text-sm font-semibold text-gray-800"
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
                    Clinician summary
                  </button>
                  {showClin ? (
                    <p className="mb-3 whitespace-pre-wrap text-sm text-gray-700">
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
                    Patient explanation
                  </button>
                  {showPat ? (
                    <p className="mb-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
                      {row.patient_explanation || "—"}
                    </p>
                  ) : null}

                  <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/80 p-4">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      SOAP suggestions
                    </h3>
                    <div className="grid gap-2 text-sm text-gray-700">
                      {(["subjective", "objective", "assessment", "plan"] as const).map(
                        (k) => (
                          <div key={k}>
                            <span className="font-medium capitalize">{k}: </span>
                            <span className="text-gray-600">
                              {(soap[k] ?? "").trim() || "—"}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                    <button
                      type="button"
                      className={`${DS_SECONDARY_BTN} mt-3 text-xs`}
                      onClick={() => {
                        copySoapToNote(soap);
                        alert(
                          "SOAP suggestions saved. Open Clinical Notes to paste into the active note.",
                        );
                      }}
                    >
                      Copy to Current Note
                    </button>
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
              return (
                <div key={ev.id} className="relative mb-6 last:mb-0">
                  <span className="absolute -left-[1.65rem] top-1.5 h-3 w-3 rounded-full bg-teal-500" />
                  <p className="text-xs font-medium text-gray-500">
                    {ev.event_date ?? "—"}
                    {da?.modality ? ` · ${da.modality}` : ""}
                    {da?.body_part ? ` · ${da.body_part}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-gray-800">
                    {(ev.summary ?? "").trim() || "—"}
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

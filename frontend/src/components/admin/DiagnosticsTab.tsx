"use client";

import Link from "next/link";
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
  { value: "eob", label: "EOB (Explanation of Benefits)" },
  { value: "reduction_letter", label: "Reduction Letter" },
  { value: "prescription", label: "Prescription" },
  { value: "insurance_card", label: "Insurance Card" },
  { value: "id_document", label: "ID Document" },
  { value: "other", label: "Other" },
] as const;

const EOB_DOC_TYPES = new Set(["eob", "reduction_letter"]);

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

type EobCptLine = {
  code?: string;
  description?: string;
  billed?: number;
  allowed?: number;
  paid?: number;
  adjustment?: number;
  patient_responsibility?: number;
};

type EobExtractionRow = {
  id: string;
  document_id?: string | null;
  claim_id?: string | null;
  task_id?: string | null;
  insurance_company?: string | null;
  date_of_service?: string | null;
  total_billed?: number | null;
  total_allowed?: number | null;
  total_paid?: number | null;
  total_adjustment?: number | null;
  total_patient_responsibility?: number | null;
  denial_reasons?: string[] | null;
  denial_codes?: string[] | null;
  needs_resubmission?: boolean | null;
  missing_information?: string[] | null;
  raw_extraction?: { cpt_codes?: EobCptLine[] } | null;
  created_at?: string | null;
  patient_documents?: { file_name?: string; document_type?: string } | null;
};

function formatUsd(amount: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount) || 0);
}

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
  highlightDocumentId?: string | null;
};

function EobSummaryPanel({ row }: { row: EobExtractionRow }) {
  const needsResub = Boolean(row.needs_resubmission);
  const denialReasons = Array.isArray(row.denial_reasons) ? row.denial_reasons : [];
  const denialCodes = Array.isArray(row.denial_codes) ? row.denial_codes : [];
  const missingInfo = Array.isArray(row.missing_information)
    ? row.missing_information
    : [];
  const cptLines = Array.isArray(row.raw_extraction?.cpt_codes)
    ? row.raw_extraction!.cpt_codes!
    : [];
  const docLabel =
    row.patient_documents?.document_type === "reduction_letter"
      ? "Reduction Letter"
      : "EOB";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
          {docLabel}
        </span>
        {row.insurance_company ? (
          <span className="text-sm font-medium text-gray-800">
            {row.insurance_company}
          </span>
        ) : null}
        {row.date_of_service ? (
          <span className="text-sm text-gray-500">{row.date_of_service}</span>
        ) : null}
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            needsResub
              ? "bg-red-100 text-red-800"
              : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {needsResub ? "Denied" : "Eligible / Paid"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Total Billed", row.total_billed],
            ["Total Allowed", row.total_allowed],
            ["Total Paid", row.total_paid],
            ["Patient Responsibility", row.total_patient_responsibility],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {label}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
              {formatUsd(value)}
            </p>
          </div>
        ))}
      </div>

      {cptLines.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 font-semibold">CPT Code</th>
                <th className="px-3 py-2 font-semibold">Description</th>
                <th className="px-3 py-2 font-semibold">Billed</th>
                <th className="px-3 py-2 font-semibold">Allowed</th>
                <th className="px-3 py-2 font-semibold">Paid</th>
                <th className="px-3 py-2 font-semibold">Adjustment</th>
                <th className="px-3 py-2 font-semibold">Patient Resp</th>
              </tr>
            </thead>
            <tbody>
              {cptLines.map((line, idx) => (
                <tr key={`${line.code ?? idx}`} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{line.code ?? "—"}</td>
                  <td className="max-w-[180px] px-3 py-2">{line.description ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{formatUsd(line.billed)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatUsd(line.allowed)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatUsd(line.paid)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatUsd(line.adjustment)}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatUsd(line.patient_responsibility)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {needsResub ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          Resubmission Required
        </div>
      ) : null}

      {denialReasons.length > 0 ||
      denialCodes.length > 0 ||
      missingInfo.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-amber-100 bg-amber-50/50 px-4 py-3 text-sm">
          {denialReasons.length > 0 ? (
            <div>
              <p className="mb-1 font-semibold text-gray-800">Denial reasons</p>
              <ul className="list-inside list-disc text-gray-700">
                {denialReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {denialCodes.length > 0 ? (
            <div>
              <p className="mb-1 font-semibold text-gray-800">Denial codes</p>
              <ul className="list-inside list-disc text-gray-700">
                {denialCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {missingInfo.length > 0 ? (
            <div>
              <p className="mb-1 font-semibold text-gray-800">Missing information</p>
              <ul className="list-inside list-disc text-gray-700">
                {missingInfo.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {row.claim_id ? (
          <Link
            href={`/admin/billing?claim_id=${encodeURIComponent(row.claim_id)}`}
            className="text-sm font-medium text-teal-700 hover:underline"
          >
            View Claim →
          </Link>
        ) : null}
        {row.task_id ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
            Task Created
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function DiagnosticsTab({
  patientId,
  clinicId,
  highlightDocumentId,
}: Props) {
  const [documentType, setDocumentType] = useState<string>("mri_report");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<DiagnosticRow[]>([]);
  const [eobExtractions, setEobExtractions] = useState<EobExtractionRow[]>([]);
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
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const loadData = useCallback(async () => {
    try {
      const h = await authHeaders();
      const [diagRes, tlRes, eobRes] = await Promise.all([
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/diagnostics?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/imaging-timeline?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/eob-extractions?clinic_id=${encodeURIComponent(clinicId)}`,
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
      if (eobRes.ok) {
        const rows = (await eobRes.json()) as EobExtractionRow[];
        setEobExtractions(Array.isArray(rows) ? rows : []);
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
    if (!highlightDocumentId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlightDocumentId, eobExtractions]);

  useEffect(() => {
    const checkComplete = (docId: string) => {
      const clinical = analyses.find((a) => a.document_id === docId);
      if (clinical && (clinical.clinician_summary ?? "").trim().length > 0) {
        return true;
      }
      return eobExtractions.some((e) => e.document_id === docId);
    };

    setAnalyzingDocIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of prev) {
        if (checkComplete(id)) {
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
        if (checkComplete(id)) {
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
  }, [analyses, eobExtractions, analyzingDocIds.size, rerunningDocIds.size]);

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
      const isEob = EOB_DOC_TYPES.has(documentType);
      setToast(
        isEob
          ? "EOB uploaded — financial extraction in progress"
          : "Document uploaded — analysis in progress",
      );
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
    (id) =>
      !analyses.some((a) => a.document_id === id) &&
      !eobExtractions.some((e) => e.document_id === id),
  );

  const clinicalAnalyses = analyses.filter((row) => {
    const docType = row.patient_documents?.document_type ?? "";
    return !EOB_DOC_TYPES.has(docType);
  });

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
        ) : clinicalAnalyses.length === 0 &&
          eobExtractions.length === 0 &&
          orphanAnalyzing.length === 0 ? (
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
            {eobExtractions.map((row) => {
              const docId = row.document_id ?? "";
              const analyzing =
                (docId && analyzingDocIds.has(docId)) ||
                (docId && rerunningDocIds.has(docId));
              const highlighted = highlightDocumentId === docId;

              if (analyzing) {
                return (
                  <div
                    key={`eob-analyzing-${row.id}`}
                    className={`${DS_CARD} flex items-center gap-3 p-5 text-sm text-gray-600`}
                  >
                    <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
                    Extracting EOB financial data…
                  </div>
                );
              }

              return (
                <div
                  key={row.id}
                  id={docId ? `eob-summary-${docId}` : undefined}
                  ref={highlighted ? highlightRef : undefined}
                  className={`${DS_CARD} p-5 ${
                    highlighted ? "ring-2 ring-teal-400 ring-offset-2" : ""
                  }`}
                >
                  <EobSummaryPanel row={row} />
                  {docId ? (
                    <div className="mt-4 border-t border-gray-100 pt-3">
                      <button
                        type="button"
                        className={`${DS_SECONDARY_BTN} text-xs`}
                        disabled={rerunningDocIds.has(docId)}
                        onClick={() => void rerunAnalysis(docId)}
                      >
                        {rerunningDocIds.has(docId)
                          ? "Re-running…"
                          : "Re-run Extraction"}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {clinicalAnalyses.map((row) => {
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

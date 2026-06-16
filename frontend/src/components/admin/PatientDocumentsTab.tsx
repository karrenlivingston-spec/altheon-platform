"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  DS_CARD,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
  DS_TABLE_WRAP,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp";

const DOC_TYPES = [
  { value: "prescription", label: "Prescription" },
  { value: "insurance_card", label: "Insurance Card" },
  { value: "id_document", label: "ID Document" },
  { value: "pdf_report", label: "PDF Report" },
  { value: "eob", label: "EOB (Explanation of Benefits)" },
  { value: "reduction_letter", label: "Reduction Letter" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
] as const;

type PatientDocumentRow = {
  id: string;
  file_name?: string | null;
  document_type?: string | null;
  created_at?: string | null;
  uploaded_by?: string | null;
  upload_source?: string | null;
  signed_url?: string | null;
};

type EobExtractionSummary = {
  id: string;
  document_id?: string | null;
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

function docTypeLabel(value: string | null | undefined): string {
  const v = (value ?? "").toLowerCase();
  const found = DOC_TYPES.find((d) => d.value === v);
  if (found) return found.label;
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "—";
}

function formatUploadDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function uploadedByLabel(row: PatientDocumentRow): string {
  if (row.uploaded_by) return "Staff";
  const src = (row.upload_source ?? "").toLowerCase();
  if (src === "patient_portal" || src === "aria") return "Patient";
  return "—";
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
      resolve(
        new Response(xhr.responseText, {
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
  onViewEobAnalysis?: (documentId: string) => void;
};

export function PatientDocumentsTab({
  patientId,
  clinicId,
  onViewEobAnalysis,
}: Props) {
  const [documents, setDocuments] = useState<PatientDocumentRow[]>([]);
  const [eobByDocId, setEobByDocId] = useState<Map<string, EobExtractionSummary>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [documentType, setDocumentType] = useState<string>("other");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    setError(null);
    try {
      const h = await authHeaders();
      const [docRes, eobRes] = await Promise.all([
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/documents?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/eob-extractions?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
      ]);
      if (!docRes.ok) {
        throw new Error("Could not load documents");
      }
      const rows = (await docRes.json()) as PatientDocumentRow[];
      setDocuments(Array.isArray(rows) ? rows : []);

      if (eobRes.ok) {
        const eobRows = (await eobRes.json()) as EobExtractionSummary[];
        const map = new Map<string, EobExtractionSummary>();
        for (const row of Array.isArray(eobRows) ? eobRows : []) {
          const docId = row.document_id ?? "";
          if (docId) map.set(docId, row);
        }
        setEobByDocId(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

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
      setUploadOpen(false);
      setToast("Document uploaded");
      await loadDocuments();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function deleteDocument(documentId: string) {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    setDeletingId(documentId);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}/documents/${encodeURIComponent(documentId)}?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: "DELETE", headers: h },
      );
      if (!res.ok) {
        throw new Error("Delete failed");
      }
      setToast("Document deleted");
      await loadDocuments();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  function isEobType(docType: string | null | undefined): boolean {
    const t = (docType ?? "").toLowerCase();
    return t === "eob" || t === "reduction_letter";
  }

  return (
    <div className="space-y-4">
      {toast ? (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
          Patient documents
        </h2>
        <button
          type="button"
          className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2 text-sm`}
          onClick={() => {
            setUploadError(null);
            setUploadOpen(true);
          }}
        >
          <Upload className="h-4 w-4" />
          Upload Document
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      <div className={DS_TABLE_WRAP}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>File Name</th>
                <th className={DS_TH}>Type</th>
                <th className={DS_TH}>Upload Date</th>
                <th className={DS_TH}>Uploaded By</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    No documents uploaded yet.
                  </td>
                </tr>
              ) : (
                documents.map((row) => {
                  const docType = row.document_type ?? "";
                  const eob = eobByDocId.get(row.id);
                  return (
                    <tr key={row.id} className={DS_TR}>
                      <td className={`${DS_TD_PRIMARY} max-w-[200px] truncate`}>
                        {row.file_name ?? "—"}
                      </td>
                      <td className={DS_TD_PRIMARY}>{docTypeLabel(docType)}</td>
                      <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                        {formatUploadDate(row.created_at)}
                      </td>
                      <td className={DS_TD_PRIMARY}>{uploadedByLabel(row)}</td>
                      <td className={DS_TD_PRIMARY}>
                        <div className="flex flex-wrap items-center gap-2">
                          {row.signed_url ? (
                            <>
                              <a
                                href={row.signed_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-teal-700 hover:underline"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                View
                              </a>
                              <a
                                href={row.signed_url}
                                download={row.file_name ?? "document"}
                                className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </a>
                            </>
                          ) : null}
                          {isEobType(docType) && eob && onViewEobAnalysis ? (
                            <button
                              type="button"
                              className="text-teal-700 hover:underline"
                              onClick={() => onViewEobAnalysis(row.id)}
                            >
                              View EOB Analysis →
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={deletingId === row.id}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 disabled:opacity-50"
                            onClick={() => void deleteDocument(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingId === row.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {uploadOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`${DS_CARD} relative w-full max-w-lg p-6`}>
            <button
              type="button"
              className="absolute right-4 top-4 rounded p-1 text-gray-500 hover:bg-gray-100"
              onClick={() => !uploading && setUploadOpen(false)}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">
              Upload document
            </h3>

            <label className="mb-3 block text-sm font-medium text-gray-700">
              Document type
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="mt-1 block h-9 w-full rounded-lg border border-gray-200 px-3 text-sm"
              >
                {DOC_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div
              className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-teal-200 bg-teal-50/40 px-6 py-6 text-center"
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
                  <Upload className="mb-2 h-7 w-7 text-teal-600" />
                  <p className="text-sm font-medium text-gray-800">
                    Click to select a file
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
        </div>
      ) : null}
    </div>
  );
}

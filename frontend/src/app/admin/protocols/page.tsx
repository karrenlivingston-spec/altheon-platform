"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Trash2, Upload, X } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const MAX_BYTES = 20 * 1024 * 1024;
const PDF_ACCEPT = ".pdf,application/pdf";

const CATEGORY_OPTIONS = [
  { value: "testing-protocol", label: "Testing protocol" },
  { value: "algorithm", label: "Algorithm" },
  { value: "research-journal", label: "Research journal" },
] as const;

type ClinicDocumentRow = {
  id: string;
  clinic_id?: string;
  title?: string | null;
  category?: string | null;
  storage_path?: string | null;
  uploaded_by?: string | null;
  visibility?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function parseApiError(json: unknown, fallback: string): string {
  if (
    json &&
    typeof json === "object" &&
    "detail" in json &&
    typeof (json as { detail: unknown }).detail === "string"
  ) {
    return (json as { detail: string }).detail;
  }
  return fallback;
}

function formatUploadDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function categoryLabel(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "—";
  const preset = CATEGORY_OPTIONS.find((o) => o.value === v);
  if (preset) return preset.label;
  return v.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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

export default function AdminProtocolsPage() {
  const { clinicId } = useClinic();
  const { isAdmin } = usePermissions();

  const [documents, setDocuments] = useState<ClinicDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState<string>(
    CATEGORY_OPTIONS[0].value,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    if (!clinicId) return;
    setError(null);
    setLoading(true);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/clinic-documents?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        throw new Error(
          parseApiError(json, `Could not load protocol documents (${res.status}).`),
        );
      }
      const rows = (await res.json()) as ClinicDocumentRow[];
      setDocuments(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setDocuments([]);
      setError(
        e instanceof Error ? e.message : "Could not load protocol documents.",
      );
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  function resetUploadForm() {
    setUploadTitle("");
    setUploadCategory(CATEGORY_OPTIONS[0].value);
    setSelectedFile(null);
    setUploadError(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openUploadModal() {
    resetUploadForm();
    setUploadOpen(true);
  }

  function closeUploadModal() {
    if (uploading) return;
    setUploadOpen(false);
    resetUploadForm();
  }

  function onFileSelected(file: File | null) {
    setUploadError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are supported.");
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError("File exceeds 20MB limit.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    if (!uploadTitle.trim()) {
      const base = file.name.replace(/\.pdf$/i, "").trim();
      if (base) setUploadTitle(base);
    }
  }

  async function submitUpload() {
    if (!clinicId) return;
    const title = uploadTitle.trim();
    if (!title) {
      setUploadError("Title is required.");
      return;
    }
    if (!selectedFile) {
      setUploadError("Select a PDF file to upload.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    try {
      const h = await authHeaders();
      const form = new FormData();
      form.append("file", selectedFile);
      form.append("clinic_id", clinicId);
      form.append("title", title);
      form.append("category", uploadCategory);

      const res = await uploadWithProgress(
        `${API_BASE}/clinic-documents`,
        form,
        h,
        setUploadProgress,
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        throw new Error(parseApiError(json, `Upload failed (${res.status}).`));
      }

      setUploadOpen(false);
      resetUploadForm();
      setToast("Document uploaded");
      await loadDocuments();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function downloadDocument(docId: string) {
    if (!clinicId) return;
    setActionError(null);
    setDownloadingId(docId);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/clinic-documents/${encodeURIComponent(docId)}/download?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        throw new Error(
          parseApiError(json, `Could not download document (${res.status}).`),
        );
      }
      const data = (await res.json()) as { signed_url?: string };
      const url = (data.signed_url ?? "").trim();
      if (!url) {
        throw new Error("Download URL was not returned.");
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not download document.",
      );
    } finally {
      setDownloadingId(null);
    }
  }

  async function deleteDocument(docId: string, title: string) {
    if (!clinicId || !isAdmin) return;
    const label = title.trim() || "this document";
    if (
      !window.confirm(
        `Delete "${label}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setActionError(null);
    setDeletingId(docId);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/clinic-documents/${encodeURIComponent(docId)}?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: "DELETE", headers: h },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        throw new Error(
          parseApiError(json, `Delete failed (${res.status}).`),
        );
      }
      setToast("Document deleted");
      await loadDocuments();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={DS_PAGE_ROOT}>
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
          <h1 className={DS_PAGE_TITLE}>Protocols</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Clinic reference documents — testing protocols, algorithms, and
            research materials.
          </p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2`}
            onClick={openUploadModal}
          >
            <Upload className="h-4 w-4" aria-hidden />
            Upload Document
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <div className={`${DS_TABLE_WRAP} mt-8`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Title</th>
                <th className={DS_TH}>Category</th>
                <th className={DS_TH}>Uploaded</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Loading…
                    </span>
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                    No protocol documents yet.
                  </td>
                </tr>
              ) : (
                documents.map((row) => (
                  <tr key={row.id} className={DS_TR}>
                    <td className={`${DS_TD_PRIMARY} font-medium text-gray-900`}>
                      {row.title?.trim() || "—"}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {categoryLabel(row.category)}
                    </td>
                    <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                      {formatUploadDate(row.created_at)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={downloadingId === row.id}
                          className="inline-flex items-center gap-1 text-teal-700 hover:underline disabled:opacity-50"
                          onClick={() => void downloadDocument(row.id)}
                        >
                          {downloadingId === row.id ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Opening…
                            </>
                          ) : (
                            <>
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              Download
                            </>
                          )}
                        </button>
                        {isAdmin ? (
                          <button
                            type="button"
                            disabled={deletingId === row.id}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 disabled:opacity-50"
                            onClick={() =>
                              void deleteDocument(row.id, row.title ?? "")
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            {deletingId === row.id ? "Deleting…" : "Delete"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {uploadOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeUploadModal();
          }}
          role="presentation"
        >
          <div
            className={`${DS_CARD} relative w-full max-w-lg p-6`}
            role="dialog"
            aria-modal
            aria-labelledby="protocol-upload-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="absolute right-4 top-4 rounded p-1 text-gray-500 hover:bg-gray-100"
              onClick={closeUploadModal}
              disabled={uploading}
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <h3
              id="protocol-upload-title"
              className="mb-4 text-lg font-semibold text-gray-900"
            >
              Upload protocol document
            </h3>

            <label className="mb-3 block text-sm font-medium text-gray-700">
              Title
              <input
                type="text"
                value={uploadTitle}
                disabled={uploading}
                onChange={(e) => setUploadTitle(e.target.value)}
                className={`mt-1 block w-full ${DS_INPUT}`}
                placeholder="e.g. APS Development Master Plan"
              />
            </label>

            <label className="mb-4 block text-sm font-medium text-gray-700">
              Category
              <select
                value={uploadCategory}
                disabled={uploading}
                onChange={(e) => setUploadCategory(e.target.value)}
                className={`mt-1 block w-full ${DS_INPUT}`}
              >
                {CATEGORY_OPTIONS.map((o) => (
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
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={PDF_ACCEPT}
                className="hidden"
                disabled={uploading}
                onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
              />
              {uploading ? (
                <div className="w-full max-w-xs">
                  <div className="mb-2 flex items-center justify-center gap-2 text-sm text-teal-800">
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
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
                  <Upload className="mb-2 h-7 w-7 text-teal-600" aria-hidden />
                  <p className="text-sm font-medium text-gray-800">
                    {selectedFile
                      ? selectedFile.name
                      : "Click to select a PDF"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">PDF only — max 20MB</p>
                </>
              )}
            </div>

            {uploadError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {uploadError}
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className={DS_SECONDARY_BTN}
                disabled={uploading}
                onClick={closeUploadModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2 disabled:opacity-60`}
                disabled={uploading || !selectedFile || !uploadTitle.trim()}
                onClick={() => void submitUpload()}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Uploading…
                  </>
                ) : (
                  "Upload"
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";

import {
  DS_CARD,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";
import {
  type ApsSession,
  mapApsUploadError,
} from "@/components/admin/performance/apsTypes";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type UploadApsContext = {
  patientId: string;
  patientName: string;
  clinicId: string;
};

type UploadApsReportModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (session: ApsSession) => void;
  context: UploadApsContext | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function parseApiDetail(json: unknown, fallback: string): string {
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

export default function UploadApsReportModal({
  open,
  onClose,
  onSuccess,
  context,
}: UploadApsReportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setBusy(false);
    setSubmitError(null);
  }, [open, context?.patientId]);

  if (!open || !context) return null;

  function handleClose() {
    if (busy) return;
    onClose();
  }

  function handleFileChange(next: File | null) {
    setSubmitError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!next.name.toLowerCase().endsWith(".pdf")) {
      setSubmitError("Only PDF files are supported.");
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!context) {
      setSubmitError("Missing patient context — close and reopen this dialog.");
      return;
    }
    if (!file) {
      setSubmitError("Select a Kinvent force-plate PDF to upload.");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("patient_id", context.patientId);
      form.append("clinic_id", context.clinicId);

      const res = await fetch(`${API_BASE}/aps/sessions/upload`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const detail = parseApiDetail(json, await res.text().catch(() => ""));
        setSubmitError(mapApsUploadError(res.status, detail));
        return;
      }

      const session = (await res.json()) as ApsSession;
      onSuccess(session);
      onClose();
    } catch {
      setSubmitError(
        "Something went wrong while uploading the report. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className={`max-h-[92vh] w-full max-w-lg overflow-y-auto ${DS_CARD}`}>
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Upload Kinvent Report</h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload a Kinvent Smart Mode PDF to suggest confirmatory tests — not a diagnosis.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form className="mt-4 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
            <dl className="space-y-2">
              <div>
                <dt className="text-xs font-semibold uppercase text-gray-500">Patient</dt>
                <dd className="font-medium text-gray-900">
                  {context.patientName || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-gray-500">Report type</dt>
                <dd className="text-gray-900">Kinvent Smart Mode force-plate PDF</dd>
              </div>
            </dl>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase text-gray-500">
              PDF file
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className={`${DS_SECONDARY_BTN} inline-flex w-full items-center justify-center gap-2 disabled:opacity-50`}
            >
              <Upload className="h-4 w-4" />
              {file ? "Change file" : "Choose PDF"}
            </button>
            {file ? (
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
                <FileText className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
                {file.name}
              </p>
            ) : (
              <p className="mt-2 text-xs text-gray-500">Only .pdf files are accepted.</p>
            )}
          </div>

          {busy ? (
            <div
              className="flex items-start gap-3 rounded-lg border border-teal-100 bg-teal-50/80 px-4 py-3 text-sm text-teal-900"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
              <div>
                <p className="font-medium">Analyzing report…</p>
                <p className="mt-1 text-teal-800/90">
                  Extracting jump-test data from the PDF. This usually takes several seconds.
                </p>
              </div>
            </div>
          ) : null}

          {submitError ? (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              className={DS_SECONDARY_BTN}
              onClick={handleClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2 disabled:opacity-50`}
              disabled={busy || !file}
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Analyzing…
                </>
              ) : (
                "Upload & analyze"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp";
const MAX_BYTES = 20 * 1024 * 1024;

export default function UploadDocumentsPage() {
  const [token, setToken] = useState("");
  const [firstName, setFirstName] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [validating, setValidating] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [complete, setComplete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token")?.trim() ?? "";
    setToken(t);
    if (!t) {
      setInvalid(true);
      setValidating(false);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/public/document-upload/${encodeURIComponent(t)}`,
        );
        if (!res.ok) {
          setInvalid(true);
          return;
        }
        const data = (await res.json()) as {
          patient_first_name?: string;
          clinic_name?: string;
        };
        setFirstName(String(data.patient_first_name ?? "Patient"));
        setClinicName(String(data.clinic_name ?? "Your clinic"));
      } catch {
        setInvalid(true);
      } finally {
        setValidating(false);
      }
    })();
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!token) return;
      if (file.size > MAX_BYTES) {
        setError("File exceeds 20MB limit.");
        return;
      }
      setUploading(true);
      setUploadProgress(0);
      setError(null);

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("document_type", "other");

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            "POST",
            `${API_BASE}/public/document-upload/${encodeURIComponent(token)}`,
          );
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(xhr.responseText || "Upload failed"));
            }
          };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(form);
        });

        setComplete(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [token],
  );

  if (validating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Verifying secure link…
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Link unavailable</h1>
          <p className="mt-2 text-sm text-gray-600">
            This upload link has expired or is invalid. Please contact your clinic
            for a new link.
          </p>
        </div>
      </div>
    );
  }

  if (complete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
            ✓
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Thank you</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your documents have been received. Your care team will review them
            before your appointment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 py-12"
      style={{
        background: "linear-gradient(160deg, #0f2f2a 0%, #0b1f2d 100%)",
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/95 p-8 shadow-xl">
        <h1 className="text-xl font-semibold text-gray-900">Secure document upload</h1>
        <p className="mt-2 text-sm text-gray-600">
          Hi {firstName}, upload imaging or reports for{" "}
          <span className="font-medium text-gray-800">{clinicName}</span>.
        </p>

        <label className="mt-6 flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/50 px-4 py-8 text-center">
          <input
            type="file"
            accept={ACCEPT}
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
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
              <span className="text-sm font-medium text-gray-800">Choose a file</span>
              <span className="mt-1 text-xs text-gray-500">
                PDF, JPG, PNG, HEIC, WEBP — max 20MB
              </span>
            </>
          )}
        </label>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

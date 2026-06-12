"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const PROCEDURE_OPTIONS = [
  "Dry Needling",
  "Manual Therapy",
  "Therapeutic Exercise",
  "Neuromuscular Re-education",
  "Ultrasound",
  "Electrical Stimulation",
  "Heat/Cold Therapy",
  "Traction",
  "Gait Training",
] as const;

export type PlanOfCareNote = {
  id: string;
  patient_id: string;
  clinic_id: string;
  note_type?: string | null;
  plan?: string | null;
  author_name?: string | null;
  diagnosis_code?: string | null;
};

type PlanOfCareModalProps = {
  note: PlanOfCareNote;
  clinicId: string;
  patientName?: string | null;
  onClose: () => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function downloadBase64Pdf(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PlanOfCareModal({
  note,
  clinicId,
  patientName,
  onClose,
}: PlanOfCareModalProps) {
  const [frequency, setFrequency] = useState("");
  const [durationWeeks, setDurationWeeks] = useState(4);
  const [diagnosisCode, setDiagnosisCode] = useState(
    (note.diagnosis_code ?? "").trim(),
  );
  const [diagnosisDescription, setDiagnosisDescription] = useState("");
  const [selectedProcedures, setSelectedProcedures] = useState<string[]>([]);
  const [customProcedure, setCustomProcedure] = useState("");
  const [shortTermGoals, setShortTermGoals] = useState("");
  const [longTermGoals, setLongTermGoals] = useState("");
  const [clinicianSignature, setClinicianSignature] = useState(
    (note.author_name ?? "").trim(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allProcedures = useMemo(() => {
    const set = new Set(selectedProcedures);
    return Array.from(set);
  }, [selectedProcedures]);

  const toggleProcedure = useCallback((name: string) => {
    setSelectedProcedures((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name],
    );
  }, []);

  const addCustomProcedure = useCallback(() => {
    const value = customProcedure.trim();
    if (!value) return;
    setSelectedProcedures((prev) =>
      prev.includes(value) ? prev : [...prev, value],
    );
    setCustomProcedure("");
  }, [customProcedure]);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/plan-of-care/generate?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            note_id: note.id,
            patient_id: note.patient_id,
            clinic_id: clinicId,
            frequency: frequency.trim(),
            duration_weeks: durationWeeks,
            short_term_goals: shortTermGoals.trim(),
            long_term_goals: longTermGoals.trim(),
            procedures: allProcedures,
            diagnosis_code: diagnosisCode.trim(),
            diagnosis_description: diagnosisDescription.trim(),
            clinician_signature: clinicianSignature.trim(),
          }),
        },
      );
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof errJson?.detail === "string"
            ? errJson.detail
            : `Generation failed (${res.status})`,
        );
      }
      const data = (await res.json()) as {
        pdf_base64?: string;
        filename?: string;
      };
      if (!data.pdf_base64) {
        throw new Error("Server returned no PDF data");
      }
      downloadBase64Pdf(
        data.pdf_base64,
        data.filename ?? `POC_${note.id}.pdf`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate Plan of Care");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className={`max-h-[92vh] w-full max-w-3xl overflow-y-auto ${DS_CARD}`}
        role="dialog"
        aria-modal
        aria-labelledby="poc-modal-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
          <div>
            <h2 id="poc-modal-title" className="text-lg font-semibold text-gray-900">
              Plan of Care
            </h2>
            <p className="text-sm text-gray-500">
              {patientName?.trim() || "Patient"} · Generate faxable POC PDF
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
              Frequency
            </label>
            <input
              type="text"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              placeholder="e.g. 3x per week"
              className={DS_INPUT}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
              Duration
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={52}
                value={durationWeeks}
                onChange={(e) =>
                  setDurationWeeks(Math.max(1, Number(e.target.value) || 1))
                }
                className={`${DS_INPUT} w-24`}
              />
              <span className="text-sm text-gray-600">weeks</span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
              Diagnosis Code
            </label>
            <input
              type="text"
              value={diagnosisCode}
              onChange={(e) => setDiagnosisCode(e.target.value)}
              placeholder="e.g. M54.5"
              className={DS_INPUT}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
              Diagnosis Description
            </label>
            <input
              type="text"
              value={diagnosisDescription}
              onChange={(e) => setDiagnosisDescription(e.target.value)}
              placeholder="e.g. Low back pain"
              className={DS_INPUT}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-xs font-semibold uppercase text-gray-500">
            Procedures / Interventions
          </label>
          <div className="flex flex-wrap gap-2">
            {PROCEDURE_OPTIONS.map((option) => {
              const active = selectedProcedures.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleProcedure(option)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-teal-600 bg-teal-50 text-teal-800"
                      : "border-gray-200 bg-white text-gray-700 hover:border-teal-300"
                  }`}
                >
                  {option}
                </button>
              );
            })}
            {selectedProcedures
              .filter((p) => !PROCEDURE_OPTIONS.includes(p as (typeof PROCEDURE_OPTIONS)[number]))
              .map((custom) => (
                <button
                  key={custom}
                  type="button"
                  onClick={() => toggleProcedure(custom)}
                  className="rounded-full border border-teal-600 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800"
                >
                  {custom} ×
                </button>
              ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={customProcedure}
              onChange={(e) => setCustomProcedure(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomProcedure();
                }
              }}
              placeholder="Add custom procedure"
              className={DS_INPUT}
            />
            <button
              type="button"
              onClick={addCustomProcedure}
              className={DS_SECONDARY_BTN}
            >
              Add
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            Short-Term Goals
          </label>
          <textarea
            value={shortTermGoals}
            onChange={(e) => setShortTermGoals(e.target.value)}
            placeholder="Goals to achieve within 2 weeks"
            rows={3}
            className={`${DS_INPUT} resize-y`}
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            Long-Term Goals
          </label>
          <textarea
            value={longTermGoals}
            onChange={(e) => setLongTermGoals(e.target.value)}
            placeholder="Goals to achieve by end of plan"
            rows={3}
            className={`${DS_INPUT} resize-y`}
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
            Clinician Signature
          </label>
          <input
            type="text"
            value={clinicianSignature}
            onChange={(e) => setClinicianSignature(e.target.value)}
            placeholder="Dr. Jane Smith, DPT"
            className={DS_INPUT}
          />
        </div>

        {note.plan?.trim() ? (
          <p className="mt-4 text-xs text-gray-500">
            Medical necessity section will include the SOAP Plan text from this note.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button type="button" onClick={onClose} className={DS_SECONDARY_BTN}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading}
            className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2 disabled:opacity-50`}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Generating…
              </>
            ) : (
              "Generate PDF"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

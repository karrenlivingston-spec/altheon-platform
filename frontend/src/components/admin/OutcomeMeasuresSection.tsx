"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_SECTION_HEADER,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";
import {
  formTypeLabel,
  interpretationColorClass,
} from "@/lib/outcomeMeasureForms";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const NY = "America/New_York";

type OutcomeResultRow = {
  id: string;
  form_type?: string;
  score?: number | null;
  percentage?: number | null;
  interpretation?: string | null;
  completed_at?: string | null;
};

type FormTypeOption = "ndi" | "odi" | "quickdash";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatCompletedDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: NY,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(raw));
  } catch {
    return "—";
  }
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function OutcomeMeasuresSection({
  clinicId,
  patientId,
}: {
  clinicId: string;
  patientId: string;
}) {
  const [results, setResults] = useState<OutcomeResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formType, setFormType] = useState<FormTypeOption>("ndi");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    if (!patientId || !clinicId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/outcome-measures/patient/${encodeURIComponent(patientId)}?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setFetchError(t.trim() || `Could not load results (${res.status})`);
        setResults([]);
        return;
      }
      const json = (await res.json()) as { results?: unknown };
      setResults(
        Array.isArray(json.results) ? (json.results as OutcomeResultRow[]) : [],
      );
    } catch {
      setFetchError("Could not load outcome measures.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  async function handleSend() {
    if (!patientId || !clinicId) return;
    setSendBusy(true);
    setSendError(null);
    setSendSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/outcome-measures/send`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          patient_id: patientId,
          clinic_id: clinicId,
          form_type: formType,
        }),
      });
      if (!res.ok) {
        setSendError(await res.text().catch(() => "Failed to send"));
        return;
      }
      setSendSuccess("Outcome measure link sent via SMS.");
      setModalOpen(false);
    } catch {
      setSendError("Failed to send outcome measure.");
    } finally {
      setSendBusy(false);
    }
  }

  return (
    <div className={`mt-8 ${DS_CARD}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className={DS_SECTION_HEADER}>Outcome Measures</h2>
        <button
          type="button"
          onClick={() => {
            setSendError(null);
            setSendSuccess(null);
            setModalOpen(true);
          }}
          className={DS_PRIMARY_BTN}
        >
          Send Outcome Measure
        </button>
      </div>

      {sendSuccess ? (
        <p className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {sendSuccess}
        </p>
      ) : null}
      {sendError && !modalOpen ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {sendError}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading outcome measures…</p>
      ) : fetchError ? (
        <p className="text-sm text-amber-800">{fetchError}</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-gray-500">No completed outcome measures yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Date
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Form
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Score
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Percentage
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Interpretation
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => {
                const interp = (row.interpretation ?? "").trim() || "—";
                return (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                      {formatCompletedDate(row.completed_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      {formTypeLabel(row.form_type ?? "")}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-900">
                      {formatScore(row.score)}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-900">
                      {row.percentage != null
                        ? `${formatScore(row.percentage)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${interpretationColorClass(interp)}`}
                      >
                        {interp}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="send-outcome-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 shadow-xl">
            <h3
              id="send-outcome-title"
              className="text-lg font-semibold text-gray-900"
            >
              Send Outcome Measure
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              An SMS with a secure link will be sent to the patient&apos;s phone.
            </p>
            <label className="mt-4 block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Form type
              </span>
              <select
                className={`mt-1 w-full ${DS_INPUT}`}
                value={formType}
                onChange={(e) => setFormType(e.target.value as FormTypeOption)}
              >
                <option value="ndi">NDI — Neck</option>
                <option value="odi">ODI — Low Back</option>
                <option value="quickdash">QuickDASH — Arm/Shoulder</option>
              </select>
            </label>
            {sendError ? (
              <p className="mt-3 text-sm text-red-700">{sendError}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={sendBusy}
                onClick={() => setModalOpen(false)}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendBusy}
                onClick={() => void handleSend()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
              >
                {sendBusy ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

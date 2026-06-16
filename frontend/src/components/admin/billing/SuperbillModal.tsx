"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  InsuranceClaimDetail,
  claimStatusBadgeClass,
  claimStatusLabel,
  formatUsdAmount,
} from "@/components/admin/billing/billingTypes";
import { WaitlistPatientOption } from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type SuperbillModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
};

async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function patientLabel(p: WaitlistPatientOption): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown";
}

function formatDos(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function claimNumber(c: InsuranceClaimDetail, index: number): string {
  if (c.claim_number) return c.claim_number;
  const dos = formatDos(c.first_treatment_date);
  if (dos !== "—") {
    return `CLM-${dos.replace(/-/g, "")}-${String(index + 1).padStart(3, "0")}`;
  }
  return c.id ? `CLM-${c.id.slice(0, 8).toUpperCase()}` : `CLM-${index + 1}`;
}

export default function SuperbillModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
}: SuperbillModalProps) {
  const { clinicId } = useClinic();

  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<WaitlistPatientOption[]>(
    [],
  );
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] =
    useState<WaitlistPatientOption | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [claims, setClaims] = useState<InsuranceClaimDetail[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const searchPatients = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q || !clinicId) return [];
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(q)}`,
        { headers: await authHeaders() },
      );
      const json = res.ok ? await res.json() : [];
      return Array.isArray(json) ? (json as WaitlistPatientOption[]) : [];
    },
    [clinicId],
  );

  const resetState = useCallback(() => {
    setPatientQuery("");
    setPatientResults([]);
    setPatientPickerOpen(false);
    setSelectedPatient(null);
    setClaims([]);
    setSelectedClaimId(null);
    setGenerating(false);
    setClaimsLoading(false);
    setSearchLoading(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  useEffect(() => {
    if (!patientPickerOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [patientPickerOpen]);

  useEffect(() => {
    if (!patientPickerOpen) return;
    const q = patientQuery.trim();
    if (!q) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      (async () => {
        setSearchLoading(true);
        try {
          const rows = await searchPatients(q);
          if (!cancelled) setPatientResults(rows);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [patientPickerOpen, patientQuery, searchPatients]);

  useEffect(() => {
    if (!isOpen || !clinicId || !selectedPatient?.id) {
      setClaims([]);
      setSelectedClaimId(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setClaimsLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/billing/claims?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: await authHeaders() },
        );
        if (!res.ok) {
          if (!cancelled) setClaims([]);
          return;
        }
        const data = (await res.json()) as InsuranceClaimDetail[];
        const filtered = (Array.isArray(data) ? data : [])
          .filter((c) => c.patient_id === selectedPatient.id)
          .sort((a, b) =>
            String(b.first_treatment_date ?? b.created_at ?? "").localeCompare(
              String(a.first_treatment_date ?? a.created_at ?? ""),
            ),
          );
        if (!cancelled) {
          setClaims(filtered);
          setSelectedClaimId(filtered[0]?.id ?? null);
        }
      } catch {
        if (!cancelled) setClaims([]);
      } finally {
        if (!cancelled) setClaimsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, clinicId, selectedPatient?.id]);

  function handleClose() {
    if (generating) return;
    onClose();
  }

  async function handleGenerate() {
    if (!clinicId || !selectedClaimId) {
      onError?.("Select a claim to generate a superbill.");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/billing/superbill`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({
          clinic_id: clinicId,
          claim_id: selectedClaimId,
        }),
      });

      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const detail =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : "Could not generate superbill";
        onError?.(detail);
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? "superbill.pdf";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      onSuccess?.("Superbill generated successfully");
      onClose();
    } catch {
      onError?.("Could not generate superbill.");
    } finally {
      setGenerating(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="superbill-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <h2
            id="superbill-modal-title"
            className="text-lg font-semibold text-gray-900"
          >
            Create Superbill
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={generating}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div ref={pickerRef} className="relative">
            <label className="block text-sm font-medium text-gray-700">
              Patient
              <input
                type="text"
                value={
                  selectedPatient && !patientPickerOpen
                    ? patientLabel(selectedPatient)
                    : patientQuery
                }
                onChange={(e) => {
                  setSelectedPatient(null);
                  setPatientQuery(e.target.value);
                  setPatientPickerOpen(true);
                }}
                onFocus={() => setPatientPickerOpen(true)}
                className={`mt-1 ${DS_INPUT}`}
                placeholder="Search by name or phone…"
              />
            </label>
            {patientPickerOpen && (patientQuery.trim() || searchLoading) ? (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {searchLoading ? (
                  <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
                ) : patientResults.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-500">
                    No patients found
                  </li>
                ) : (
                  patientResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                        onClick={() => {
                          setSelectedPatient(p);
                          setPatientQuery(patientLabel(p));
                          setPatientPickerOpen(false);
                        }}
                      >
                        {patientLabel(p)}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>

          {selectedPatient ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">
                Select claim
              </h3>
              {claimsLoading ? (
                <p className="text-sm text-gray-500">Loading claims…</p>
              ) : claims.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  No claims found for this patient
                </p>
              ) : (
                <div className={DS_TABLE_WRAP}>
                  <table className="min-w-full">
                    <thead className={DS_TABLE_HEAD}>
                      <tr>
                        <th className={DS_TH} aria-label="Select" />
                        <th className={DS_TH}>Claim #</th>
                        <th className={DS_TH}>DOS</th>
                        <th className={DS_TH}>Payer</th>
                        <th className={DS_TH}>Amount</th>
                        <th className={DS_TH}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claims.map((claim, index) => {
                        const status = String(claim.status ?? "draft").toLowerCase();
                        const selected = selectedClaimId === claim.id;
                        return (
                          <tr
                            key={claim.id}
                            className={`${DS_TR} cursor-pointer ${
                              selected ? "bg-teal-50/60" : ""
                            }`}
                            onClick={() => setSelectedClaimId(claim.id)}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="radio"
                                name="superbill-claim"
                                checked={selected}
                                onChange={() => setSelectedClaimId(claim.id)}
                                aria-label={`Select claim ${claimNumber(claim, index)}`}
                              />
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {claimNumber(claim, index)}
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {formatDos(claim.first_treatment_date)}
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {claim.payer_name || "—"}
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {claim.total_amount != null
                                ? formatUsdAmount(claim.total_amount)
                                : "—"}
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              <span className={claimStatusBadgeClass(status)}>
                                {claimStatusLabel(status)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              className={DS_SECONDARY_BTN}
              onClick={handleClose}
              disabled={generating}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2 disabled:opacity-60`}
              disabled={
                generating || !selectedPatient || !selectedClaimId || claims.length === 0
              }
              onClick={() => void handleGenerate()}
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Generating superbill…
                </>
              ) : (
                "Generate Superbill"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

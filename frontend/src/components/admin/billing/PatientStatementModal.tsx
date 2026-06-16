"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  InsuranceClaimDetail,
  formatUsdAmount,
} from "@/components/admin/billing/billingTypes";
import { WaitlistPatientOption } from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type DeliveryOption = "download" | "sms" | "both";

export type PatientStatementModalProps = {
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

const DELIVERY_OPTIONS: { value: DeliveryOption; label: string }[] = [
  { value: "download", label: "Download PDF" },
  { value: "sms", label: "Send via SMS" },
  { value: "both", label: "Both" },
];

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export default function PatientStatementModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
}: PatientStatementModalProps) {
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
  const [delivery, setDelivery] = useState<DeliveryOption>("download");
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
    setDelivery("download");
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
        const filtered = (Array.isArray(data) ? data : []).filter(
          (c) => c.patient_id === selectedPatient.id,
        );
        if (!cancelled) setClaims(filtered);
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

  const summary = useMemo(() => {
    let totalBilled = 0;
    let insurancePaid = 0;
    for (const c of claims) {
      const billed = Number(c.total_amount ?? 0) || 0;
      totalBilled += billed;
      if (String(c.status ?? "").toLowerCase() === "paid") {
        insurancePaid += billed;
      }
    }
    const balanceDue = Math.max(0, totalBilled - insurancePaid);
    return { totalBilled, insurancePaid, balanceDue };
  }, [claims]);

  function handleClose() {
    if (generating) return;
    onClose();
  }

  function successMessage(deliveryUsed: DeliveryOption): string {
    if (deliveryUsed === "sms") return "Statement sent via SMS";
    if (deliveryUsed === "both") return "Statement sent and downloaded";
    return "Statement downloaded";
  }

  async function handleGenerate() {
    if (!clinicId || !selectedPatient?.id) {
      onError?.("Select a patient to generate a statement.");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/billing/patient-statement`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: selectedPatient.id,
          delivery,
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
            : "Could not generate statement";
        onError?.(detail);
        return;
      }

      if (delivery === "download" || delivery === "both") {
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const match = /filename="([^"]+)"/.exec(disposition);
        const filename = match?.[1] ?? "statement.pdf";

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      onSuccess?.(successMessage(delivery));
      onClose();
    } catch {
      onError?.("Could not generate statement.");
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
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="patient-statement-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <h2
            id="patient-statement-modal-title"
            className="text-lg font-semibold text-gray-900"
          >
            Patient Statement
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
                Account summary
              </h3>
              {claimsLoading ? (
                <p className="text-sm text-gray-500">Loading account…</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <SummaryCard
                    label="Total Billed"
                    value={formatUsdAmount(summary.totalBilled)}
                  />
                  <SummaryCard
                    label="Insurance Paid"
                    value={formatUsdAmount(summary.insurancePaid)}
                  />
                  <SummaryCard
                    label="Balance Due"
                    value={formatUsdAmount(summary.balanceDue)}
                  />
                </div>
              )}
            </div>
          ) : null}

          {selectedPatient ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">Delivery</h3>
              <div className="space-y-2">
                {DELIVERY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 text-sm text-gray-800"
                  >
                    <input
                      type="radio"
                      name="statement-delivery"
                      value={opt.value}
                      checked={delivery === opt.value}
                      onChange={() => setDelivery(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
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
              disabled={generating || !selectedPatient}
              onClick={() => void handleGenerate()}
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Generating statement…
                </>
              ) : (
                "Generate Statement"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

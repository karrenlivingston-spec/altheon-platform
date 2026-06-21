"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import { DS_PRIMARY_BTN, DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import {
  InsuranceClaimDetail,
  claimStatusBadgeClass,
  claimStatusLabel,
} from "@/components/admin/billing/billingTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type ClaimDetailModalProps = {
  claimId: string | null;
  patientName?: string;
  isOpen: boolean;
  onClose: () => void;
  onError?: (message: string) => void;
  onStatusUpdated?: () => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function formatAmount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function Field({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-900">{value}</dd>
    </div>
  );
}

export default function ClaimDetailModal({
  claimId,
  patientName,
  isOpen,
  onClose,
  onError,
  onStatusUpdated,
}: ClaimDetailModalProps) {
  const { clinicId } = useClinic();
  const [claim, setClaim] = useState<InsuranceClaimDetail | null>(null);
  const [resolvedPatientName, setResolvedPatientName] = useState(
    patientName ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const canViewCms1500 =
    !!claim &&
    String(claim.status ?? "").trim().toLowerCase() !== "draft" &&
    !!String(claim.reference_number ?? "").trim();

  const canCheckStatus =
    !!claim && !!String(claim.reference_number ?? "").trim();

  async function handleCheckStatus() {
    if (!claimId) return;
    setStatusChecking(true);
    setStatusError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/billing/claims/${encodeURIComponent(claimId)}/status`,
        { headers: h },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof err?.detail === "string"
            ? err.detail
            : "Could not check claim status",
        );
      }
      const data = (await res.json()) as InsuranceClaimDetail;
      setClaim(data);
      onStatusUpdated?.();
    } catch (e) {
      setStatusError(
        e instanceof Error ? e.message : "Could not check claim status",
      );
    } finally {
      setStatusChecking(false);
    }
  }

  async function openCms1500Pdf() {
    if (!claimId) return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/billing/claims/${encodeURIComponent(claimId)}/cms1500-pdf`,
        { headers: h },
      );
      if (!res.ok) {
        let message = "Could not load CMS-1500 PDF.";
        try {
          const json = (await res.json()) as { detail?: unknown };
          if (typeof json.detail === "string" && json.detail.trim()) {
            message = json.detail;
          }
        } catch {
          /* ignore */
        }
        setPdfError(message);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setPdfError("Could not load CMS-1500 PDF.");
    } finally {
      setPdfLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !claimId) {
      setClaim(null);
      setResolvedPatientName(patientName ?? "");
      setPdfError(null);
      setStatusError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/billing/claims/${encodeURIComponent(claimId)}`,
          { headers: h },
        );
        if (!res.ok) {
          onError?.("Could not load claim details.");
          return;
        }
        const data = (await res.json()) as InsuranceClaimDetail;
        if (cancelled) return;
        setClaim(data);

        if (!patientName && data.patient_id && clinicId) {
          const pRes = await fetch(
            `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=`,
            { headers: h },
          );
          const patients = pRes.ok ? await pRes.json() : [];
          if (Array.isArray(patients)) {
            const match = patients.find(
              (p: { id: string }) => p.id === data.patient_id,
            ) as { first_name?: string; last_name?: string } | undefined;
            if (match) {
              setResolvedPatientName(
                `${match.first_name ?? ""} ${match.last_name ?? ""}`.trim() ||
                  data.patient_id,
              );
            } else {
              setResolvedPatientName(data.patient_id);
            }
          }
        } else {
          setResolvedPatientName(patientName ?? "");
        }
      } catch {
        if (!cancelled) onError?.("Could not load claim details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, claimId, clinicId, patientName, onError]);

  if (!isOpen) return null;

  const dx = claim?.diagnosis_codes?.length
    ? claim.diagnosis_codes.join(", ")
    : "—";
  const cpt = claim?.cpt_codes?.length ? claim.cpt_codes.join(", ") : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="claim-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <div>
            <h2
              id="claim-detail-title"
              className="text-lg font-semibold text-gray-900"
            >
              Claim Details
            </h2>
            {claim?.claim_number ? (
              <p className="mt-0.5 font-mono text-sm text-gray-500">
                {claim.claim_number}
              </p>
            ) : null}
          </div>
          {claim?.status ? (
            <span className={claimStatusBadgeClass(claim.status)}>
              {claimStatusLabel(claim.status)}
            </span>
          ) : null}
        </div>

        {statusError ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {statusError}
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-gray-500">Loading…</p>
        ) : claim ? (
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Patient" value={resolvedPatientName || "—"} />
            <Field
              label="Date of First Treatment"
              value={formatDate(claim.first_treatment_date)}
            />
            <Field label="Payer Name" value={claim.payer_name ?? "—"} />
            <Field label="Payer ID" value={claim.payer_id ?? "—"} />
            <Field label="Policy Number" value={claim.policy_number ?? "—"} />
            <Field label="Member ID" value={claim.member_id ?? "—"} />
            <Field label="Total Amount" value={formatAmount(claim.total_amount)} />
            <Field
              label="Filing Deadline"
              value={formatDate(claim.filing_deadline)}
            />
            <Field label="Created" value={formatDate(claim.created_at)} />
            <Field label="Updated" value={formatDate(claim.updated_at)} />
            <div className="sm:col-span-2">
              <Field label="Diagnosis Codes" value={dx} />
            </div>
            <div className="sm:col-span-2">
              <Field label="CPT Codes" value={cpt} />
            </div>
            {claim.notes ? (
              <div className="sm:col-span-2">
                <Field label="Notes" value={claim.notes} />
              </div>
            ) : null}
            {canCheckStatus || canViewCms1500 ? (
              <div className="sm:col-span-2 flex flex-wrap gap-3">
                {canCheckStatus ? (
                  <button
                    type="button"
                    className={`${DS_SECONDARY_BTN} inline-flex items-center gap-2 disabled:opacity-60`}
                    disabled={statusChecking}
                    onClick={() => void handleCheckStatus()}
                  >
                    {statusChecking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Checking status…
                      </>
                    ) : (
                      "Check Status"
                    )}
                  </button>
                ) : null}
                {canViewCms1500 ? (
                  <>
                    <button
                      type="button"
                      className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
                      disabled={pdfLoading}
                      onClick={() => void openCms1500Pdf()}
                    >
                      {pdfLoading ? "Loading CMS-1500…" : "View CMS-1500 Claim Form"}
                    </button>
                    {pdfError ? (
                      <p className="w-full text-sm text-amber-800">{pdfError}</p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-6 text-sm text-gray-500">Claim not found.</p>
        )}

        <div className="mt-6 flex justify-end border-t border-gray-100 pt-4">
          <button type="button" onClick={onClose} className={DS_SECONDARY_BTN}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

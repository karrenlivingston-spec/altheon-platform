"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, DollarSign, Percent } from "lucide-react";
import Link from "next/link";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import ClaimDetailModal from "@/components/admin/billing/ClaimDetailModal";
import CollectionRateBar from "@/components/admin/billing/CollectionRateBar";
import {
  InsuranceClaimDetail,
  PayerSummaryDetailRow,
  PayerSummaryReportData,
  claimStatusBadgeClass,
  claimStatusLabel,
  formatUsdAmount,
} from "@/components/admin/billing/billingTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function StatCard({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Icon className="absolute right-4 top-4 h-5 w-5 text-gray-300" aria-hidden />
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
    </div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

type PayerClaimsModalProps = {
  payerName: string | null;
  clinicId: string;
  isOpen: boolean;
  onClose: () => void;
  onViewClaim: (claim: InsuranceClaimDetail) => void;
};

function PayerClaimsModal({
  payerName,
  clinicId,
  isOpen,
  onClose,
  onViewClaim,
}: PayerClaimsModalProps) {
  const [claims, setClaims] = useState<InsuranceClaimDetail[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !payerName || !clinicId) {
      setClaims([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
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
          (c) =>
            String(c.payer_name ?? "").trim().toLowerCase() ===
            payerName.trim().toLowerCase(),
        );
        if (!cancelled) setClaims(filtered);
      } catch {
        if (!cancelled) setClaims([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, payerName, clinicId]);

  if (!isOpen || !payerName) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="payer-claims-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="payer-claims-title"
          className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
        >
          Claims — {payerName}
        </h2>

        {loading ? (
          <p className="mt-6 text-sm text-gray-500">Loading claims…</p>
        ) : claims.length === 0 ? (
          <p className="mt-6 text-sm text-gray-500">No claims for this payer.</p>
        ) : (
          <div className={`${DS_TABLE_WRAP} mt-4`}>
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Date</th>
                  <th className={DS_TH}>Amount</th>
                  <th className={DS_TH}>Status</th>
                  <th className={DS_TH}>Action</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.id} className={DS_TR}>
                    <td className={DS_TD_PRIMARY}>
                      {formatDate(claim.first_treatment_date)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {claim.total_amount != null
                        ? formatUsdAmount(claim.total_amount)
                        : "—"}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <span
                        className={claimStatusBadgeClass(claim.status ?? "")}
                      >
                        {claimStatusLabel(claim.status ?? "")}
                      </span>
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <button
                        type="button"
                        onClick={() => onViewClaim(claim)}
                        className="text-sm font-medium text-teal-600 hover:text-teal-700"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

export default function PayerSummaryPage() {
  const { clinicId } = useClinic();
  const [data, setData] = useState<PayerSummaryReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimsPayer, setClaimsPayer] = useState<string | null>(null);
  const [detailClaimId, setDetailClaimId] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/payer-summary?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof err?.detail === "string"
            ? err.detail
            : `Failed to load payer summary (${res.status})`,
        );
      }
      setData((await res.json()) as PayerSummaryReportData);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load payer summary.",
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-6">
        <p className="mb-1 text-sm">
          <Link
            href="/admin/billing"
            className="font-medium text-teal-600 hover:text-teal-700"
          >
            ← Back to Billing
          </Link>
        </p>
        <h1 className={DS_PAGE_TITLE}>Payer Summary</h1>
        <p className={DS_PAGE_SUBTITLE}>
          Collections performance by insurance carrier
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <StatCard
          icon={Building2}
          value={loading ? "…" : String(data?.summary.total_payers ?? 0)}
          label="Total Payers"
        />
        <StatCard
          icon={DollarSign}
          value={
            loading
              ? "…"
              : formatUsdAmount(data?.summary.total_billed_all ?? 0)
          }
          label="Total Billed"
        />
        <StatCard
          icon={Percent}
          value={
            loading
              ? "…"
              : `${data?.summary.overall_collection_rate ?? 0}%`
          }
          label="Overall Collection Rate"
        />
      </div>

      <div className={DS_CARD}>
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          All Payers
        </h2>

        <div className={DS_TABLE_WRAP}>
          <table className="min-w-full divide-y divide-gray-100">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Payer</th>
                <th className={DS_TH}>Claims</th>
                <th className={DS_TH}>Billed</th>
                <th className={DS_TH}>Collected</th>
                <th className={DS_TH}>Outstanding</th>
                <th className={DS_TH}>Denied</th>
                <th className={DS_TH}>Collection Rate</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    Loading payer summary…
                  </td>
                </tr>
              ) : !data?.payers.length ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    No payer data yet
                  </td>
                </tr>
              ) : (
                data.payers.map((row: PayerSummaryDetailRow) => (
                  <tr key={row.payer_name} className={DS_TR}>
                    <td className={DS_TD_PRIMARY}>{row.payer_name}</td>
                    <td className={DS_TD_PRIMARY}>{row.claim_count}</td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdAmount(row.total_billed)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdAmount(row.total_collected)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdAmount(row.total_outstanding)}
                    </td>
                    <td className={DS_TD_PRIMARY}>{row.denied_count}</td>
                    <td className={DS_TD_PRIMARY}>
                      <CollectionRateBar
                        rate={row.collection_rate}
                        className="min-w-[120px]"
                      />
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <button
                        type="button"
                        onClick={() => setClaimsPayer(row.payer_name)}
                        className="text-sm font-medium text-teal-600 hover:text-teal-700"
                      >
                        View Claims →
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PayerClaimsModal
        payerName={claimsPayer}
        clinicId={clinicId}
        isOpen={Boolean(claimsPayer)}
        onClose={() => setClaimsPayer(null)}
        onViewClaim={(claim) => {
          setClaimsPayer(null);
          setDetailClaimId(claim.id);
        }}
      />

      <ClaimDetailModal
        isOpen={Boolean(detailClaimId)}
        claimId={detailClaimId}
        onClose={() => setDetailClaimId(null)}
      />
    </div>
  );
}

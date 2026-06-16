"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, MoreHorizontal } from "lucide-react";
import Link from "next/link";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import NewClaimModal from "@/components/admin/appointments/NewClaimModal";
import AgingDonut from "@/components/admin/billing/AgingDonut";
import ClaimDetailModal from "@/components/admin/billing/ClaimDetailModal";
import {
  AGING_BUCKET_META,
  AgingBucketFilter,
  AgingClaimRow,
  AgingReportData,
  CLAIM_STATUS_OPTIONS,
  claimStatusBadgeClass,
  claimStatusLabel,
  formatUsdAmount,
} from "@/components/admin/billing/billingTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const BUCKET_TABS: { key: AgingBucketFilter; label: string }[] = [
  { key: "all", label: "All" },
  ...AGING_BUCKET_META.map((b) => ({
    key: b.filter as AgingBucketFilter,
    label: b.shortLabel,
  })),
];

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(
      value.includes("T") ? value : `${value}T12:00:00`,
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value.slice(0, 10);
  }
}

export default function AgingReportPage() {
  const { clinicId } = useClinic();
  const [data, setData] = useState<AgingReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<AgingBucketFilter>("all");
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [detailClaim, setDetailClaim] = useState<AgingClaimRow | null>(null);
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const loadReport = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/aging-report?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof err?.detail === "string"
            ? err.detail
            : `Failed to load aging report (${res.status})`,
        );
      }
      setData((await res.json()) as AgingReportData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load aging report.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!menuId) return;
    function onDocMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuId]);

  const filteredClaims =
    data?.claims.filter((c) =>
      bucketFilter === "all" ? true : c.bucket === bucketFilter,
    ) ?? [];

  function showSuccess(message: string) {
    setToast({ kind: "success", message });
  }

  function showError(message: string) {
    setToast({ kind: "error", message });
  }

  function openEdit(claim: AgingClaimRow) {
    setEditingClaimId(claim.id);
    setIsClaimModalOpen(true);
  }

  function closeClaimModal() {
    setIsClaimModalOpen(false);
    setEditingClaimId(null);
  }

  async function handleDelete(claim: AgingClaimRow) {
    const ok = window.confirm(
      `Delete draft claim ${claim.claim_number}? This cannot be undone.`,
    );
    if (!ok) return;

    try {
      const res = await fetch(
        `${API_BASE}/billing/claims/${encodeURIComponent(claim.id)}`,
        { method: "DELETE", headers: await authHeaders() },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        showError(
          typeof err?.detail === "string"
            ? err.detail
            : "Could not delete claim",
        );
        return;
      }
      showSuccess("Claim deleted");
      void loadReport();
    } catch {
      showError("Could not delete claim");
    }
  }

  async function handleStatusChange(claim: AgingClaimRow, status: string) {
    try {
      const res = await fetch(
        `${API_BASE}/billing/claims/${encodeURIComponent(claim.id)}`,
        {
          method: "PATCH",
          headers: {
            ...(await authHeaders()),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        showError(
          typeof err?.detail === "string"
            ? err.detail
            : "Could not update claim status",
        );
        return;
      }
      showSuccess("Claim status updated");
      void loadReport();
    } catch {
      showError("Could not update claim status");
    }
  }

  const summaryByBucket = new Map(
    (data?.summary ?? []).map((s) => [s.bucket, s]),
  );

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
        <h1 className={DS_PAGE_TITLE}>Aging Report</h1>
        <p className={DS_PAGE_SUBTITLE}>
          Outstanding receivables by age bucket
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {AGING_BUCKET_META.map((meta) => {
          const summary = summaryByBucket.get(meta.filter);
          const count = summary?.count ?? 0;
          const amount = summary?.total_amount ?? 0;
          const active = bucketFilter === meta.filter;

          return (
            <button
              key={meta.filter}
              type="button"
              onClick={() => setBucketFilter(meta.filter)}
              className={`rounded-xl border p-4 text-left transition-shadow hover:shadow-sm ${meta.cardClass} ${
                active ? "ring-2 ring-teal-500 ring-offset-2" : ""
              }`}
            >
              <p className={`text-sm font-semibold ${meta.textClass}`}>
                {meta.label}
              </p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{count}</p>
              <p className="mt-1 text-sm text-gray-600">
                {loading ? "…" : formatUsdAmount(amount)}
              </p>
            </button>
          );
        })}
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-5">
          {data ? (
            <AgingDonut
              aging={data.aging}
              title="Outstanding by Bucket"
              showLegend
            />
          ) : (
            <div className={`${DS_CARD} h-72 animate-pulse`} />
          )}
        </div>
        <div className={`${DS_CARD} xl:col-span-7 flex flex-col justify-center p-6`}>
          <p className="text-sm text-gray-500">Total outstanding claims</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            {loading ? "…" : (data?.claims.length ?? 0)}
          </p>
          <p className="mt-4 text-sm text-gray-600">
            Unpaid claims grouped by days since date of first treatment. Select a
            bucket above to filter the table below.
          </p>
          <button
            type="button"
            onClick={() => setBucketFilter("all")}
            className="mt-4 w-fit text-sm font-medium text-teal-600 hover:text-teal-700"
          >
            Show all buckets
          </button>
        </div>
      </div>

      <div className={DS_CARD}>
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Outstanding Claims
          </h2>
          <div className="flex flex-wrap gap-2">
            {BUCKET_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setBucketFilter(tab.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  bucketFilter === tab.key
                    ? "bg-teal-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className={DS_TABLE_WRAP}>
          <table className="min-w-full divide-y divide-gray-100">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Claim #</th>
                <th className={DS_TH}>Patient</th>
                <th className={DS_TH}>Payer</th>
                <th className={DS_TH}>Date of Service</th>
                <th className={DS_TH}>Days Outstanding</th>
                <th className={DS_TH}>Amount</th>
                <th className={DS_TH}>Status</th>
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
                    Loading aging report…
                  </td>
                </tr>
              ) : filteredClaims.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    No outstanding claims in this bucket
                  </td>
                </tr>
              ) : (
                filteredClaims.map((claim) => {
                  const isDraft =
                    String(claim.status ?? "").toLowerCase() === "draft";
                  const currentStatus = String(
                    claim.status ?? "",
                  ).toLowerCase();

                  return (
                    <tr key={claim.id} className={DS_TR}>
                      <td className={`${DS_TD_PRIMARY} font-mono text-xs`}>
                        {claim.claim_number}
                      </td>
                      <td className={DS_TD_PRIMARY}>{claim.patient_name}</td>
                      <td className={DS_TD_PRIMARY}>{claim.payer_name}</td>
                      <td className={DS_TD_PRIMARY}>
                        {formatDate(claim.first_treatment_date)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {claim.days_outstanding}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {formatUsdAmount(claim.total_amount)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <span className={claimStatusBadgeClass(claim.status)}>
                          {claimStatusLabel(claim.status)}
                        </span>
                      </td>
                      <td className={`${DS_TD_PRIMARY} relative`}>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDetailClaim(claim)}
                            className="rounded p-1 text-gray-500 hover:bg-gray-100"
                            aria-label="View claim"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMenuId(
                                menuId === claim.id ? null : claim.id,
                              )
                            }
                            className="rounded p-1 text-gray-500 hover:bg-gray-100"
                            aria-label="More actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </div>
                        {menuId === claim.id ? (
                          <div
                            ref={menuRef}
                            className="absolute right-0 top-8 z-20 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
                          >
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                              onClick={() => {
                                setMenuId(null);
                                openEdit(claim);
                              }}
                            >
                              Edit
                            </button>
                            {isDraft ? (
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                                onClick={() => {
                                  setMenuId(null);
                                  void handleDelete(claim);
                                }}
                              >
                                Delete
                              </button>
                            ) : null}
                            <div className="my-1 border-t border-gray-100" />
                            <p className="px-3 py-1 text-xs font-medium text-gray-400">
                              Change status
                            </p>
                            {CLAIM_STATUS_OPTIONS.filter(
                              (s) => s !== currentStatus,
                            ).map((status) => (
                              <button
                                key={status}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                                onClick={() => {
                                  setMenuId(null);
                                  void handleStatusChange(claim, status);
                                }}
                              >
                                {claimStatusLabel(status)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewClaimModal
        isOpen={isClaimModalOpen}
        onClose={closeClaimModal}
        existingClaim={editingClaimId ? { id: editingClaimId } : null}
        onSuccess={() => {
          showSuccess("Claim updated");
          closeClaimModal();
          void loadReport();
        }}
        onError={showError}
      />

      <ClaimDetailModal
        isOpen={Boolean(detailClaim)}
        claimId={detailClaim?.id ?? null}
        patientName={detailClaim?.patient_name}
        onClose={() => setDetailClaim(null)}
        onError={showError}
      />

      {toast ? (
        <div
          className={`fixed right-4 bottom-4 z-[70] rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${
            toast.kind === "success" ? "bg-[#16A34A]" : "bg-[#DC2626]"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

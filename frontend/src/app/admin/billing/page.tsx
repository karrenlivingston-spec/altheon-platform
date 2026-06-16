"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, FileBarChart } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import NewClaimModal from "@/components/admin/appointments/NewClaimModal";
import AgingDonut from "@/components/admin/billing/AgingDonut";
import BillingMetrics from "@/components/admin/billing/BillingMetrics";
import ClaimDetailModal from "@/components/admin/billing/ClaimDetailModal";
import ClaimsAction from "@/components/admin/billing/ClaimsAction";
import ClaimsList, { type ClaimsFilter } from "@/components/admin/billing/ClaimsList";
import ERAPanel from "@/components/admin/billing/ERAPanel";
import PatientStatementModal from "@/components/admin/billing/PatientStatementModal";
import PayerSummary from "@/components/admin/billing/PayerSummary";
import SuperbillModal from "@/components/admin/billing/SuperbillModal";
import {
  BillingClaimRow,
  BillingDashboardData,
  InsuranceClaimDetail,
  currentMonthRange,
  exportClaimsCsv,
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

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function filterClaimsForExport(
  claims: InsuranceClaimDetail[],
  statusFilter: ClaimsFilter,
  dateFrom: string,
  dateTo: string,
): InsuranceClaimDetail[] {
  return claims.filter((c) => {
    const status = String(c.status ?? "").toLowerCase();
    if (statusFilter !== "all" && status !== statusFilter) return false;
    const dos = c.first_treatment_date
      ? String(c.first_treatment_date).slice(0, 10)
      : "";
    if (dateFrom && dos && dos < dateFrom) return false;
    if (dateTo && dos && dos > dateTo) return false;
    return true;
  });
}

export default function AdminBillingPage() {
  const { clinicId } = useClinic();
  const searchParams = useSearchParams();
  const claimIdFromUrl = searchParams.get("claim_id");
  const defaultRange = currentMonthRange();

  const [data, setData] = useState<BillingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<ClaimsFilter>("all");
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);

  const [isNewClaimModalOpen, setIsNewClaimModalOpen] = useState(false);
  const [isSuperbillModalOpen, setIsSuperbillModalOpen] = useState(false);
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);
  const [editingClaim, setEditingClaim] = useState<{ id: string } | null>(null);
  const [detailClaim, setDetailClaim] = useState<BillingClaimRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const fetchDashboard = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!clinicId) return;
      if (!opts?.silent) setLoading(true);

      const params = new URLSearchParams({
        clinic_id: clinicId,
        page: String(page),
        page_size: String(pageSize),
        date_from: dateFrom,
        date_to: dateTo,
      });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }

      try {
        const res = await fetch(
          `${API_BASE}/api/billing/dashboard?${params.toString()}`,
          { headers: await authHeaders() },
        );
        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as {
            detail?: string;
          } | null;
          throw new Error(
            typeof errJson?.detail === "string"
              ? errJson.detail
              : `Failed to load billing dashboard (${res.status})`,
          );
        }
        const json = (await res.json()) as BillingDashboardData;
        setData(json);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load billing dashboard");
        if (!opts?.silent) setData(null);
      } finally {
        setLoading(false);
      }
    },
    [clinicId, page, pageSize, statusFilter, dateFrom, dateTo],
  );

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (!claimIdFromUrl) return;
    const inList = data?.claims.find((c) => c.id === claimIdFromUrl);
    if (inList) {
      setDetailClaim(inList);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/billing/claims/${encodeURIComponent(claimIdFromUrl)}`,
          { headers: await authHeaders() },
        );
        if (!res.ok) return;
        const claim = (await res.json()) as InsuranceClaimDetail;
        setDetailClaim({
          id: claim.id,
          claim_number: String(claim.claim_number ?? ""),
          patient_name: "",
          insurance_carrier: String(claim.payer_name ?? ""),
          date_of_service: claim.first_treatment_date ?? null,
          total_billed_cents: Math.round(Number(claim.total_amount ?? 0) * 100),
          amount_paid_cents: 0,
          amount_remaining_cents: 0,
          status: String(claim.status ?? ""),
        });
      } catch {
        /* ignore — claim may be outside current filters */
      }
    })();
  }, [claimIdFromUrl, data?.claims]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleStatusFilter(status: string) {
    const map: Record<string, ClaimsFilter> = {
      all: "all",
      draft: "draft",
      submitted: "submitted",
      pending: "pending",
      denied: "denied",
      paid: "paid",
    };
    setStatusFilter(map[status] ?? "all");
    setPage(0);
  }

  function showSuccess(message: string) {
    setToast({ kind: "success", message });
  }

  function showError(message: string) {
    setToast({ kind: "error", message });
  }

  function openNewClaim() {
    setEditingClaim(null);
    setIsNewClaimModalOpen(true);
  }

  function openEditClaim(claim: BillingClaimRow) {
    setEditingClaim({ id: claim.id });
    setIsNewClaimModalOpen(true);
  }

  function closeClaimModal() {
    setIsNewClaimModalOpen(false);
    setEditingClaim(null);
  }

  async function handleDeleteClaim(claim: BillingClaimRow) {
    const label = claim.claim_number || claim.id;
    const ok = window.confirm(
      `Delete draft claim ${label}? This cannot be undone.`,
    );
    if (!ok) return;

    try {
      const res = await fetch(
        `${API_BASE}/billing/claims/${encodeURIComponent(claim.id)}`,
        { method: "DELETE", headers: await authHeaders() },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const detail =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        showError(detail);
        return;
      }
      showSuccess("Claim deleted");
      void fetchDashboard({ silent: true });
    } catch {
      showError("Could not delete claim");
    }
  }

  async function handleStatusChange(claim: BillingClaimRow, status: string) {
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
        const json: unknown = await res.json().catch(() => ({}));
        const detail =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        showError(detail);
        return;
      }
      showSuccess("Claim status updated");
      void fetchDashboard({ silent: true });
    } catch {
      showError("Could not update claim status");
    }
  }

  async function handleExport() {
    if (!clinicId || exporting) return;
    setExporting(true);
    try {
      const h = await authHeaders();
      const [claimsRes, patientsRes] = await Promise.all([
        fetch(
          `${API_BASE}/billing/claims?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
        fetch(
          `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=`,
          { headers: h },
        ),
      ]);

      if (!claimsRes.ok) {
        showError("Could not export claims");
        return;
      }

      const claims = (await claimsRes.json()) as InsuranceClaimDetail[];
      const patients = patientsRes.ok ? await patientsRes.json() : [];
      const nameById: Record<string, string> = {};
      if (Array.isArray(patients)) {
        for (const p of patients as {
          id: string;
          first_name?: string;
          last_name?: string;
        }[]) {
          nameById[p.id] =
            `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.id;
        }
      }

      const filtered = filterClaimsForExport(
        Array.isArray(claims) ? claims : [],
        statusFilter,
        dateFrom,
        dateTo,
      );

      if (filtered.length === 0) {
        showError("No claims match the current filters to export");
        return;
      }

      exportClaimsCsv(
        filtered,
        `claims_export_${todayYmd()}.csv`,
        nameById,
      );
      showSuccess(`Exported ${filtered.length} claim(s)`);
    } catch {
      showError("Could not export claims");
    } finally {
      setExporting(false);
    }
  }

  function handleReports() {
    setToast({ kind: "success", message: "Reports coming soon" });
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Billing</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Claims, collections, aging, and remittance at a glance
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className={`${DS_SECONDARY_BTN} inline-flex items-center gap-2 disabled:opacity-50`}
          >
            <Download className="h-4 w-4" aria-hidden />
            {exporting ? "Exporting…" : "Export"}
          </button>
          <button
            type="button"
            onClick={handleReports}
            className={`${DS_SECONDARY_BTN} inline-flex items-center gap-2`}
          >
            <FileBarChart className="h-4 w-4" aria-hidden />
            Reports
          </button>
          <button type="button" onClick={openNewClaim} className={DS_PRIMARY_BTN}>
            + New Claim
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <BillingMetrics metrics={data?.metrics} loading={loading && !data} />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-5">
          {data ? (
            <ClaimsAction action={data.claims_action} onFilter={handleStatusFilter} />
          ) : (
            <div className="h-80 animate-pulse rounded-xl border border-gray-200 bg-white" />
          )}
        </div>

        <div className="xl:col-span-4">
          {data ? (
            <AgingDonut
              aging={data.aging}
              reportHref="/admin/billing/aging-report"
            />
          ) : (
            <div className="h-80 animate-pulse rounded-xl border border-gray-200 bg-white" />
          )}
        </div>

        <div className="xl:col-span-3">
          {data ? (
            <PayerSummary
              rows={data.payer_summary}
              reportHref="/admin/billing/payer-summary"
            />
          ) : (
            <div className="h-80 animate-pulse rounded-xl border border-gray-200 bg-white" />
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="xl:col-span-9">
          <ClaimsList
            claims={data?.claims ?? []}
            total={data?.claims_total ?? 0}
            statusCounts={
              data?.claims_status_counts ?? {
                all: 0,
                submitted: 0,
                pending: 0,
                denied: 0,
                paid: 0,
                draft: 0,
              }
            }
            page={page}
            pageSize={pageSize}
            statusFilter={statusFilter}
            dateFrom={dateFrom}
            dateTo={dateTo}
            loading={loading}
            onStatusFilter={(s) => {
              setStatusFilter(s);
              setPage(0);
            }}
            onDateFrom={(v) => {
              setDateFrom(v);
              setPage(0);
            }}
            onDateTo={(v) => {
              setDateTo(v);
              setPage(0);
            }}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            onView={(claim) => setDetailClaim(claim)}
            onEdit={openEditClaim}
            onDelete={(claim) => void handleDeleteClaim(claim)}
            onStatusChange={(claim, status) =>
              void handleStatusChange(claim, status)
            }
          />
        </div>

        <div className="xl:col-span-3">
          <ERAPanel
            payments={data?.recent_payments ?? []}
            onComingSoon={(message) =>
              setToast({ kind: "success", message })
            }
            onCreateSuperbill={() => setIsSuperbillModalOpen(true)}
            onPatientStatement={() => setIsStatementModalOpen(true)}
          />
        </div>
      </div>

      <NewClaimModal
        isOpen={isNewClaimModalOpen}
        onClose={closeClaimModal}
        onSuccess={() => {
          showSuccess(editingClaim ? "Claim updated" : "Claim created");
          void fetchDashboard({ silent: true });
        }}
        onError={showError}
        existingClaim={editingClaim}
      />

      <ClaimDetailModal
        isOpen={Boolean(detailClaim)}
        claimId={detailClaim?.id ?? null}
        patientName={detailClaim?.patient_name}
        onClose={() => setDetailClaim(null)}
        onError={showError}
      />

      <SuperbillModal
        isOpen={isSuperbillModalOpen}
        onClose={() => setIsSuperbillModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />

      <PatientStatementModal
        isOpen={isStatementModalOpen}
        onClose={() => setIsStatementModalOpen(false)}
        onSuccess={showSuccess}
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

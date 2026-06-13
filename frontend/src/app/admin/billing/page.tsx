"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileBarChart } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import AgingDonut from "@/components/admin/billing/AgingDonut";
import BillingMetrics from "@/components/admin/billing/BillingMetrics";
import ClaimsAction from "@/components/admin/billing/ClaimsAction";
import ClaimsList, { type ClaimsFilter } from "@/components/admin/billing/ClaimsList";
import ERAPanel from "@/components/admin/billing/ERAPanel";
import PayerSummary from "@/components/admin/billing/PayerSummary";
import {
  BillingDashboardData,
  currentMonthRange,
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

export default function AdminBillingPage() {
  const { clinicId } = useClinic();
  const defaultRange = currentMonthRange();

  const [data, setData] = useState<BillingDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<ClaimsFilter>("all");
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);

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

  function handleStatusFilter(status: string) {
    const map: Record<string, ClaimsFilter> = {
      all: "all",
      submitted: "submitted",
      pending: "pending",
      denied: "denied",
      paid: "paid",
      draft: "all",
    };
    setStatusFilter(map[status] ?? "all");
    setPage(0);
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
          <button type="button" className={`${DS_SECONDARY_BTN} inline-flex items-center gap-2`}>
            <Download className="h-4 w-4" aria-hidden />
            Export
          </button>
          <button type="button" className={`${DS_SECONDARY_BTN} inline-flex items-center gap-2`}>
            <FileBarChart className="h-4 w-4" aria-hidden />
            Reports
          </button>
          <button type="button" className={DS_PRIMARY_BTN}>
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
            <AgingDonut aging={data.aging} />
          ) : (
            <div className="h-80 animate-pulse rounded-xl border border-gray-200 bg-white" />
          )}
        </div>

        <div className="xl:col-span-3">
          {data ? (
            <PayerSummary rows={data.payer_summary} />
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
          />
        </div>

        <div className="xl:col-span-3">
          <ERAPanel payments={data?.recent_payments ?? []} />
        </div>
      </div>
    </div>
  );
}

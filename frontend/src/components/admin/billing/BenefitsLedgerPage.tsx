"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import BillingSubNav from "@/components/admin/billing/BillingSubNav";
import { formatUsdAmount } from "@/components/admin/billing/billingTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const MEDICARE_CAP = 2480;
const MEDICARE_WARN = MEDICARE_CAP * 0.8;

export type BenefitsLedgerRow = {
  patient_id: string;
  patient_name: string;
  payer_name: string;
  visit_count: number;
  total_billed: number;
  total_paid: number;
  is_medicare: boolean;
  medicare_cap_used: number | null;
  medicare_cap_remaining: number | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function medicareBarColor(used: number): string {
  if (used >= MEDICARE_CAP) return "bg-red-500";
  if (used >= MEDICARE_WARN) return "bg-amber-500";
  return "bg-green-500";
}

function MedicareCapCell({ row }: { row: BenefitsLedgerRow }) {
  if (!row.is_medicare || row.medicare_cap_used == null) {
    return <span className="text-gray-400">—</span>;
  }

  const used = row.medicare_cap_used;
  const remaining = row.medicare_cap_remaining ?? Math.max(0, MEDICARE_CAP - used);
  const pct = Math.min(100, (used / MEDICARE_CAP) * 100);

  return (
    <div className="min-w-[140px]">
      <p className="text-xs font-medium text-gray-700">
        {formatUsdAmount(used)} / {formatUsdAmount(MEDICARE_CAP)}
      </p>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${medicareBarColor(used)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-0.5 text-xs text-gray-500">
        {formatUsdAmount(remaining)} remaining
      </p>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-200" />
      ))}
    </div>
  );
}

export default function BenefitsLedgerPage() {
  const router = useRouter();
  const { clinicId } = useClinic();
  const [rows, setRows] = useState<BenefitsLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const loadLedger = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/benefits-ledger?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof err?.detail === "string"
            ? err.detail
            : `Failed to load benefits ledger (${res.status})`,
        );
      }
      const json = (await res.json()) as BenefitsLedgerRow[];
      setRows(Array.isArray(json) ? json : []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load benefits ledger.",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.patient_name.toLowerCase().includes(q) ||
        row.payer_name.toLowerCase().includes(q),
    );
  }, [rows, search]);

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
        <h1 className={DS_PAGE_TITLE}>Benefits Ledger</h1>
        <p className={DS_PAGE_SUBTITLE}>
          Insurance utilization across all patients
        </p>
      </div>

      <BillingSubNav />

      {error ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border-2 border-[#0D9488] bg-teal-50/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-teal-900">{error}</p>
          <button
            type="button"
            onClick={() => void loadLedger()}
            className="shrink-0 rounded-lg bg-[#0D9488] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f766e]"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className={`${DS_CARD} mb-6`}>
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by patient or payer…"
            className={`${DS_INPUT} pl-9`}
          />
        </label>
      </div>

      <div className={DS_CARD}>
        <div className={DS_TABLE_WRAP}>
          <table className="min-w-full divide-y divide-gray-100">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Patient</th>
                <th className={DS_TH}>Payer</th>
                <th className={DS_TH}>Visits</th>
                <th className={DS_TH}>Billed</th>
                <th className={DS_TH}>Paid</th>
                <th className={DS_TH}>Medicare Cap</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <SkeletonTable />
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    {rows.length === 0
                      ? "No insurance utilization data yet."
                      : "No rows match your search."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr
                    key={`${row.patient_id}-${row.payer_name}`}
                    className={`${DS_TR} cursor-pointer`}
                    onClick={() =>
                      router.push(
                        `/admin/patients/${encodeURIComponent(row.patient_id)}?tab=benefits`,
                      )
                    }
                  >
                    <td className={`${DS_TD_PRIMARY} font-medium text-gray-900`}>
                      {row.patient_name}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {row.payer_name}
                        {row.is_medicare ? (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                            Medicare
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={DS_TD_PRIMARY}>{row.visit_count}</td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdAmount(row.total_billed)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdAmount(row.total_paid)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <MedicareCapCell row={row} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

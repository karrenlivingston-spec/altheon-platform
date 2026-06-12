"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { DS_CARD, DS_SECTION_HEADER } from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const MEDICARE_THRESHOLD_CENTS = 248_000;
const MEDICARE_WARN_CENTS = Math.floor(MEDICARE_THRESHOLD_CENTS * 0.8);

type CptBreakdownRow = {
  cpt_code: string;
  description: string;
  total_units: number;
  total_cents: number;
};

type BenefitsPlan = {
  carrier_name: string;
  policy_number: string;
  group_number: string;
  total_visits: number;
  total_billed_cents: number;
  total_paid_cents: number;
  is_medicare: boolean;
  calendar_year: number;
  medicare_threshold_cents: number;
  cpt_breakdown: CptBreakdownRow[];
};

type LedgerResponse = {
  plans: BenefitsPlan[];
  no_insurance?: boolean;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function formatUsdPrecise(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function carrierPillClass(carrierName: string): string {
  const lower = carrierName.toLowerCase();
  if (lower.includes("medicare")) {
    return "bg-blue-100 text-blue-800";
  }
  if (lower.includes("medicaid")) {
    return "bg-purple-100 text-purple-800";
  }
  return "bg-gray-100 text-gray-700";
}

function carrierPillLabel(carrierName: string): string {
  const lower = carrierName.toLowerCase();
  if (lower.includes("medicare")) return "Medicare";
  if (lower.includes("medicaid")) return "Medicaid";
  return "Commercial";
}

function medicareBarColor(billedCents: number): string {
  if (billedCents >= MEDICARE_THRESHOLD_CENTS) return "bg-red-500";
  if (billedCents >= MEDICARE_WARN_CENTS) return "bg-amber-500";
  return "bg-green-500";
}

type Props = {
  patientId: string;
  clinicId: string;
};

export function InsuranceBenefitsLedger({ patientId, clinicId }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LedgerResponse | null>(null);

  useEffect(() => {
    if (!patientId || !clinicId) return;

    const controller = new AbortController();
    const { signal } = controller;

    setLoading(true);
    setError(null);
    setData(null);

    void (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/benefits-ledger?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h, signal },
        );
        if (signal.aborted) return;
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail.trim() || `Could not load benefits (${res.status})`);
        }
        const json = (await res.json()) as LedgerResponse;
        if (!signal.aborted) setData(json);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (signal.aborted) return;
        setError(
          e instanceof Error ? e.message : "Could not load benefits ledger.",
        );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [patientId, clinicId]);

  if (loading) {
    return (
      <div className="mt-8 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading benefits…
      </div>
    );
  }

  if (error) {
    return (
      <p className="mt-8 rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
        {error}
      </p>
    );
  }

  if (data?.no_insurance || !data?.plans?.length) {
    return (
      <div className={`${DS_CARD} mt-8 text-center`}>
        <p className="text-sm text-gray-500">No insurance on file for this patient.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {data.plans.map((plan) => {
        const threshold = plan.medicare_threshold_cents || MEDICARE_THRESHOLD_CENTS;
        const billed = plan.total_billed_cents;
        const pct = Math.min(100, Math.round((billed / threshold) * 100));
        const remaining = Math.max(0, threshold - billed);
        const showKxWarning = plan.is_medicare && billed >= threshold;
        const zeroBilling =
          plan.total_visits === 0 &&
          plan.total_billed_cents === 0 &&
          plan.total_paid_cents === 0;

        return (
          <div key={plan.carrier_name} className={DS_CARD}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900">
                  {plan.carrier_name}
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Policy: {plan.policy_number?.trim() || "—"}
                  <span className="mx-2 text-gray-300">|</span>
                  Group: {plan.group_number?.trim() || "—"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${carrierPillClass(plan.carrier_name)}`}
              >
                {carrierPillLabel(plan.carrier_name)}
              </span>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4 border-y border-gray-100 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Visits
                </p>
                <p className="mt-1 text-xl font-semibold text-gray-900">
                  {plan.total_visits}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Billed
                </p>
                <p className="mt-1 text-xl font-semibold text-gray-900">
                  {formatUsd(plan.total_billed_cents)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Paid
                </p>
                <p className="mt-1 text-xl font-semibold text-gray-900">
                  {formatUsd(plan.total_paid_cents)}
                </p>
              </div>
            </div>

            {zeroBilling ? (
              <p className="mt-4 text-sm text-gray-500">
                No claims billed yet under this plan.
              </p>
            ) : null}

            {plan.cpt_breakdown.length > 0 ? (
              <div className="mt-6">
                <h4 className={DS_SECTION_HEADER}>CPT Codes Billed</h4>
                <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {plan.cpt_breakdown.map((row) => (
                    <li
                      key={row.cpt_code}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-mono font-medium text-gray-900">
                          {row.cpt_code}
                        </span>
                        <span className="ml-2 text-gray-600">
                          {row.description}
                        </span>
                      </div>
                      <div className="shrink-0 text-gray-700">
                        <span className="text-gray-500">×{row.total_units}</span>
                        <span className="ml-3 font-medium tabular-nums">
                          {formatUsd(row.total_cents)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.is_medicare ? (
              <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                  Therapy Cap Tracker — {plan.calendar_year}
                </p>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all ${medicareBarColor(billed)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-gray-800">
                  {formatUsdPrecise(billed)} of {formatUsdPrecise(threshold)}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {formatUsdPrecise(remaining)} remaining
                </p>
                {showKxWarning ? (
                  <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    ⚠️ KX modifier required above {formatUsdPrecise(threshold)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DS_INPUT,
  DS_PRIMARY_BTN,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const CPT_DESCRIPTIONS: Record<string, string> = {
  "97161": "PT Eval Low",
  "97162": "PT Eval Mod",
  "97163": "PT Eval High",
  "97164": "PT Re-Eval",
  "97110": "Therapeutic Ex",
  "97112": "Neuromusc Re-ed",
  "97530": "Therapeutic Act",
  "97140": "Manual Therapy",
  "97010": "Hot/Cold Pack",
  "97014": "E-Stim (Unatt.)",
  G0283: "E-Stim (Medicare)",
};

const CATEGORY_BADGE: Record<string, string> = {
  commercial: "bg-blue-100 text-blue-800",
  medicaid: "bg-purple-100 text-purple-800",
  medicare: "bg-teal-100 text-teal-800",
  workers_comp: "bg-orange-100 text-orange-800",
  other: "bg-gray-100 text-gray-700",
};

type PayerResult = {
  payer_name: string;
  matched: boolean;
  cpt_codes: string[];
  notes: string;
  reimbursement_amount: number | null;
};

type BillingRecommendation = {
  visit_type: string;
  primary: PayerResult;
  secondary?: PayerResult;
  union_codes: string[];
  intersection_codes: string[];
};

type PayerOption = {
  payer_name: string;
  payer_category: string;
};

export type PayerOptimizerPanelProps = {
  clinicId: string;
  appointmentId: string;
  primaryPayer: string | null;
  secondaryPayer: string | null;
  visitType: "initial" | "followup";
  onCodesSelected: (codes: string[]) => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
}

function categoryBadgeClass(category: string): string {
  const key = category.trim().toLowerCase() || "other";
  return CATEGORY_BADGE[key] ?? CATEGORY_BADGE.other;
}

function inferCategory(payerName: string, categoryMap: Map<string, string>): string {
  const fromMap = categoryMap.get(payerName.trim().toLowerCase());
  if (fromMap) return fromMap;
  const lower = payerName.toLowerCase();
  if (lower.includes("medicare")) return "medicare";
  if (lower.includes("medicaid")) return "medicaid";
  if (lower.includes("workers") || lower.includes("comp")) return "workers_comp";
  return "other";
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-40 rounded bg-gray-200" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-28 rounded-lg bg-gray-100" />
        <div className="h-28 rounded-lg bg-gray-100" />
      </div>
      <div className="h-20 rounded-lg bg-gray-100" />
    </div>
  );
}

function CodePill({ code, count }: { code: string; count?: number }) {
  const description = CPT_DESCRIPTIONS[code] ?? code;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs">
      <span className="font-mono font-semibold text-teal-700">{code}</span>
      {count != null && count > 1 ? (
        <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
          ×{count}
        </span>
      ) : null}
      <span className="text-gray-600">{description}</span>
    </span>
  );
}

function PayerColumn({
  title,
  payer,
  category,
}: {
  title: string;
  payer: PayerResult;
  category: string;
}) {
  const collapsedCodes = payer.cpt_codes.reduce(
    (acc, code) => {
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <span className="text-sm text-gray-700">{payer.payer_name}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${categoryBadgeClass(category)}`}
        >
          {category.replace(/_/g, " ")}
        </span>
      </div>

      {!payer.matched ? (
        <p className="text-sm text-gray-500">
          No billing rules found for {payer.payer_name}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {payer.cpt_codes.length > 0 ? (
              Object.entries(collapsedCodes).map(([code, count]) => (
                <CodePill key={code} code={code} count={count} />
              ))
            ) : (
              <p className="text-xs text-gray-500">No CPT codes in rule set</p>
            )}
          </div>
          {payer.notes ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {payer.notes}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function CodeCheckboxRow({
  code,
  checked,
  onChange,
  tone,
}: {
  code: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tone: "green" | "blue";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50/60"
      : "border-blue-200 bg-blue-50/60";
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${toneClass}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
      />
      <CodePill code={code} />
    </label>
  );
}

export default function PayerOptimizerPanel({
  clinicId,
  appointmentId: _appointmentId,
  primaryPayer,
  secondaryPayer,
  visitType,
  onCodesSelected,
}: PayerOptimizerPanelProps) {
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [recommendation, setRecommendation] = useState<BillingRecommendation | null>(
    null,
  );
  const [payerOptions, setPayerOptions] = useState<PayerOption[]>([]);
  const [manualPayer, setManualPayer] = useState("");
  const [payerQuery, setPayerQuery] = useState("");
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [checkedCodes, setCheckedCodes] = useState<Set<string>>(new Set());

  const effectivePrimary = (primaryPayer?.trim() || manualPayer.trim()) || null;

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of payerOptions) {
      map.set(p.payer_name.trim().toLowerCase(), p.payer_category || "other");
    }
    return map;
  }, [payerOptions]);

  const loadPayers = useCallback(async () => {
    if (!clinicId) return;
    try {
      const params = new URLSearchParams({ clinic_id: clinicId });
      const res = await fetch(`${API_BASE}/payer-optimizer/payers?${params}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { payers?: PayerOption[] };
      setPayerOptions(Array.isArray(data.payers) ? data.payers : []);
    } catch {
      /* silent */
    }
  }, [clinicId]);

  const loadRecommendation = useCallback(async () => {
    if (!clinicId || !effectivePrimary) {
      setRecommendation(null);
      setFetchError(null);
      return;
    }

    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({
        payer_primary: effectivePrimary,
        visit_type: visitType,
      });
      const secondary = secondaryPayer?.trim();
      if (secondary) params.set("payer_secondary", secondary);

      const res = await fetch(
        `${API_BASE}/payer-optimizer/clinics/${encodeURIComponent(clinicId)}/billing-recommendation?${params}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setFetchError("Unable to load billing recommendations");
        setRecommendation(null);
        return;
      }
      const data = (await res.json()) as BillingRecommendation;
      setRecommendation(data);
      const intersection = new Set(data.intersection_codes ?? []);
      setCheckedCodes(new Set(intersection));
    } catch {
      setFetchError("Unable to load billing recommendations");
      setRecommendation(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId, effectivePrimary, secondaryPayer, visitType]);

  useEffect(() => {
    void loadPayers();
  }, [loadPayers]);

  useEffect(() => {
    void loadRecommendation();
  }, [loadRecommendation]);

  const additionalCodes = useMemo(() => {
    if (!recommendation) return [];
    const intersection = new Set(recommendation.intersection_codes ?? []);
    return (recommendation.union_codes ?? []).filter((c) => !intersection.has(c));
  }, [recommendation]);

  const filteredPayerOptions = useMemo(() => {
    const q = payerQuery.trim().toLowerCase();
    if (!q) return payerOptions.slice(0, 12);
    return payerOptions
      .filter((p) => p.payer_name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [payerOptions, payerQuery]);

  const toggleCode = (code: string, checked: boolean) => {
    setCheckedCodes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  };

  const applySelected = () => {
    onCodesSelected(Array.from(checkedCodes));
  };

  if (!primaryPayer?.trim()) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
        <h3 className="text-sm font-semibold text-gray-900">Billing Optimizer</h3>
        <p className="mt-2 text-sm text-gray-600">
          No insurance on file — enter payer name to get recommendations
        </p>
        <div className="relative mt-3">
          <input
            type="text"
            value={payerQuery}
            onChange={(e) => {
              setPayerQuery(e.target.value);
              setManualPayer(e.target.value);
              setComboboxOpen(true);
            }}
            onFocus={() => setComboboxOpen(true)}
            placeholder="Search payers…"
            className={DS_INPUT}
          />
          {comboboxOpen && filteredPayerOptions.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {filteredPayerOptions.map((p) => (
                <li key={p.payer_name}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                    onClick={() => {
                      setManualPayer(p.payer_name);
                      setPayerQuery(p.payer_name);
                      setComboboxOpen(false);
                    }}
                  >
                    <span>{p.payer_name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${categoryBadgeClass(p.payer_category)}`}
                    >
                      {p.payer_category.replace(/_/g, " ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {!effectivePrimary ? null : loading ? (
          <div className="mt-4">
            <LoadingSkeleton />
          </div>
        ) : fetchError ? (
          <p className="mt-3 text-sm text-gray-500">{fetchError}</p>
        ) : recommendation ? (
          <RecommendationBody
            recommendation={recommendation}
            categoryMap={categoryMap}
            additionalCodes={additionalCodes}
            checkedCodes={checkedCodes}
            toggleCode={toggleCode}
            onApply={applySelected}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Billing Optimizer</h3>
        <span className="text-xs uppercase tracking-wide text-gray-500">
          {visitType === "initial" ? "Initial visit" : "Follow-up visit"}
        </span>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : fetchError ? (
        <p className="text-sm text-gray-500">{fetchError}</p>
      ) : recommendation ? (
        <RecommendationBody
          recommendation={recommendation}
          categoryMap={categoryMap}
          additionalCodes={additionalCodes}
          checkedCodes={checkedCodes}
          toggleCode={toggleCode}
          onApply={applySelected}
        />
      ) : (
        <p className="text-sm text-gray-500">No recommendations available.</p>
      )}
    </div>
  );
}

function RecommendationBody({
  recommendation,
  categoryMap,
  additionalCodes,
  checkedCodes,
  toggleCode,
  onApply,
}: {
  recommendation: BillingRecommendation;
  categoryMap: Map<string, string>;
  additionalCodes: string[];
  checkedCodes: Set<string>;
  toggleCode: (code: string, checked: boolean) => void;
  onApply: () => void;
}) {
  const hasSecondary = Boolean(recommendation.secondary);
  const primaryCategory = inferCategory(
    recommendation.primary.payer_name,
    categoryMap,
  );
  const secondaryCategory = recommendation.secondary
    ? inferCategory(recommendation.secondary.payer_name, categoryMap)
    : "other";

  return (
    <div className="space-y-4">
      <div
        className={`grid gap-3 ${hasSecondary ? "sm:grid-cols-2" : "grid-cols-1"}`}
      >
        <PayerColumn
          title="Primary"
          payer={recommendation.primary}
          category={primaryCategory}
        />
        {recommendation.secondary ? (
          <PayerColumn
            title="Secondary"
            payer={recommendation.secondary}
            category={secondaryCategory}
          />
        ) : null}
      </div>

      {(recommendation.intersection_codes?.length ?? 0) > 0 ||
      additionalCodes.length > 0 ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          {(recommendation.intersection_codes?.length ?? 0) > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Recommended Codes
              </h4>
              <p className="mt-0.5 text-xs text-gray-500">
                Safest to bill when both payers apply
              </p>
              <div className="mt-2 space-y-2">
                {recommendation.intersection_codes.map((code) => (
                  <CodeCheckboxRow
                    key={`int-${code}`}
                    code={code}
                    checked={checkedCodes.has(code)}
                    onChange={(checked) => toggleCode(code, checked)}
                    tone="green"
                  />
                ))}
              </div>
            </div>
          ) : null}

          {additionalCodes.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                Additional Codes
              </h4>
              <p className="mt-0.5 text-xs text-gray-500">
                Billable to at least one payer — review before selecting
              </p>
              <div className="mt-2 space-y-2">
                {additionalCodes.map((code) => (
                  <CodeCheckboxRow
                    key={`add-${code}`}
                    code={code}
                    checked={checkedCodes.has(code)}
                    onChange={(checked) => toggleCode(code, checked)}
                    tone="blue"
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="pt-1">
            <button
              type="button"
              onClick={onApply}
              disabled={checkedCodes.size === 0}
              className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
            >
              Apply Selected Codes
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-500">
          No CPT code recommendations for this payer combination.
        </div>
      )}
    </div>
  );
}

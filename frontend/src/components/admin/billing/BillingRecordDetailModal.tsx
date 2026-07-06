"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  billingStatusBadgeClass,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import PiBillingLineItemsField, {
  emptyLine,
  type LineFieldErrors,
  type LineItemDraft,
  validateLine,
} from "@/components/admin/billing/PiBillingLineItemsField";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type BillingLineItem = {
  id?: string;
  cpt_code?: string | null;
  description?: string | null;
  units?: number | null;
  rate_cents?: number | null;
  total_cents?: number | null;
};

type BillingRecordDetail = {
  id?: string;
  date_of_service?: string | null;
  status?: string | null;
  total_billed_cents?: number | null;
  line_items?: BillingLineItem[] | null;
};

type SaveOp =
  | { kind: "delete"; serverId: string; label: string }
  | {
      kind: "patch";
      serverId: string;
      label: string;
      body: { rate_cents: number; units: number };
    }
  | {
      kind: "post";
      clientLineId: string;
      label: string;
      body: { cpt_code: string; rate_cents: number; units: number };
    };

export type BillingRecordDetailModalProps = {
  recordId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRecordUpdated?: () => void;
};

async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function formatDateOfService(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return value;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

function formatUsdFromCents(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
}

function parseApiError(json: unknown, fallback: string): string {
  if (
    json &&
    typeof json === "object" &&
    "detail" in json &&
    typeof (json as { detail: unknown }).detail === "string"
  ) {
    return (json as { detail: string }).detail;
  }
  return fallback;
}

function rateCentsToInput(rateCents: number | null | undefined): string {
  if (rateCents == null) return "";
  return (Number(rateCents) / 100).toFixed(2);
}

function lineLabel(line: LineItemDraft, index: number): string {
  const code = line.cptCode.trim() || `Line ${index + 1}`;
  return `Line ${index + 1} (${code})`;
}

function itemsToDrafts(items: BillingLineItem[]): LineItemDraft[] {
  if (items.length === 0) return [emptyLine()];
  return items.map((item, index) => ({
    id: `edit-${item.id ?? index}-${Math.random().toString(36).slice(2, 9)}`,
    serverId: item.id,
    cptCode: (item.cpt_code ?? "").trim(),
    rate: rateCentsToInput(item.rate_cents),
    units: String(item.units ?? 1),
  }));
}

function baselineById(items: BillingLineItem[]): Map<string, BillingLineItem> {
  const map = new Map<string, BillingLineItem>();
  for (const item of items) {
    if (item.id) map.set(item.id, item);
  }
  return map;
}

function computeSaveOps(
  baseline: BillingLineItem[],
  lines: LineItemDraft[],
): SaveOp[] {
  const byId = baselineById(baseline);
  const draftServerIds = new Set(
    lines.map((l) => l.serverId).filter(Boolean) as string[],
  );
  const ops: SaveOp[] = [];
  const deleteIds = new Set<string>();

  for (const item of baseline) {
    if (item.id && !draftServerIds.has(item.id)) {
      deleteIds.add(item.id);
    }
  }

  lines.forEach((line, index) => {
    const label = lineLabel(line, index);
    const rateCents = Math.round(Number(line.rate) * 100);
    const unitsNum = Number(line.units);
    const cpt = line.cptCode.trim();

    if (!line.serverId) {
      ops.push({
        kind: "post",
        clientLineId: line.id,
        label,
        body: { cpt_code: cpt, rate_cents: rateCents, units: unitsNum },
      });
      return;
    }

    const original = byId.get(line.serverId);
    if (!original) return;

    const originalCpt = (original.cpt_code ?? "").trim();
    if (originalCpt !== cpt) {
      deleteIds.add(line.serverId);
      ops.push({
        kind: "post",
        clientLineId: line.id,
        label,
        body: { cpt_code: cpt, rate_cents: rateCents, units: unitsNum },
      });
      return;
    }

    const originalRate = Number(original.rate_cents ?? 0);
    const originalUnits = Number(original.units ?? 1);
    if (originalRate !== rateCents || originalUnits !== unitsNum) {
      ops.push({
        kind: "patch",
        serverId: line.serverId,
        label,
        body: { rate_cents: rateCents, units: unitsNum },
      });
    }
  });

  const deletes: SaveOp[] = [...deleteIds].map((serverId) => {
    const item = byId.get(serverId);
    const code = (item?.cpt_code ?? "").trim() || serverId.slice(0, 8);
    return {
      kind: "delete" as const,
      serverId,
      label: `Remove ${code}`,
    };
  });

  return [...deletes, ...ops.filter((op) => op.kind !== "post"), ...ops.filter((op) => op.kind === "post")];
}

async function fetchBillingRecord(
  recordId: string,
): Promise<{ data?: BillingRecordDetail; error?: string }> {
  try {
    const h = await authHeaders();
    const res = await fetch(
      `${API_BASE}/billing-records/${encodeURIComponent(recordId)}`,
      { headers: h },
    );
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).trim();
      return {
        error: text || `Could not load billing record (${res.status}).`,
      };
    }
    return { data: (await res.json()) as BillingRecordDetail };
  } catch {
    return { error: "Could not load billing record." };
  }
}

export default function BillingRecordDetailModal({
  recordId,
  isOpen,
  onClose,
  onRecordUpdated,
}: BillingRecordDetailModalProps) {
  const [record, setRecord] = useState<BillingRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [baselineItems, setBaselineItems] = useState<BillingLineItem[]>([]);
  const [editLines, setEditLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Record<number, LineFieldErrors>
  >({});

  const reloadRecord = useCallback(async (id: string) => {
    const result = await fetchBillingRecord(id);
    if (result.error) {
      setError(result.error);
      return null;
    }
    setRecord(result.data ?? null);
    return result.data ?? null;
  }, []);

  useEffect(() => {
    if (!isOpen || !recordId) {
      setRecord(null);
      setError(null);
      setEditing(false);
      setBaselineItems([]);
      setEditLines([emptyLine()]);
      setSaveError(null);
      setSubmitAttempted(false);
      setFieldErrors({});
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setRecord(null);
      setEditing(false);
      setSaveError(null);
      const data = await fetchBillingRecord(recordId);
      if (cancelled) return;
      if (data.error) {
        setError(data.error);
      } else {
        setRecord(data.data ?? null);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, recordId]);

  function startEditing() {
    const items = record?.line_items ?? [];
    setBaselineItems(items);
    setEditLines(itemsToDrafts(items));
    setSaveError(null);
    setSubmitAttempted(false);
    setFieldErrors({});
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setBaselineItems([]);
    setEditLines([emptyLine()]);
    setSaveError(null);
    setSubmitAttempted(false);
    setFieldErrors({});
  }

  async function handleSave() {
    if (!recordId || !record) return;
    setSubmitAttempted(true);
    setSaveError(null);

    const lineErrs: Record<number, LineFieldErrors> = {};
    editLines.forEach((line, index) => {
      const errs = validateLine(line);
      if (Object.keys(errs).length > 0) lineErrs[index] = errs;
    });
    setFieldErrors(lineErrs);
    if (Object.keys(lineErrs).length > 0) return;

    const ops = computeSaveOps(baselineItems, editLines);
    if (ops.length === 0) {
      setEditing(false);
      return;
    }

    setSaveBusy(true);
    const failures: { label: string; detail: string }[] = [];

    try {
      const h = await authHeaders(true);

      for (const op of ops) {
        if (op.kind === "delete") {
          const res = await fetch(
            `${API_BASE}/billing-line-items/${encodeURIComponent(op.serverId)}`,
            { method: "DELETE", headers: h },
          );
          if (!res.ok) {
            const json: unknown = await res.json().catch(() => ({}));
            failures.push({
              label: op.label,
              detail: parseApiError(json, `Error ${res.status}`),
            });
          }
          continue;
        }

        if (op.kind === "patch") {
          const res = await fetch(
            `${API_BASE}/billing-line-items/${encodeURIComponent(op.serverId)}`,
            {
              method: "PATCH",
              headers: h,
              body: JSON.stringify(op.body),
            },
          );
          if (!res.ok) {
            const json: unknown = await res.json().catch(() => ({}));
            failures.push({
              label: op.label,
              detail: parseApiError(json, `Error ${res.status}`),
            });
          }
          continue;
        }

        const res = await fetch(
          `${API_BASE}/billing-records/${encodeURIComponent(recordId)}/line-items`,
          {
            method: "POST",
            headers: h,
            body: JSON.stringify(op.body),
          },
        );
        if (!res.ok) {
          const json: unknown = await res.json().catch(() => ({}));
          failures.push({
            label: op.label,
            detail: parseApiError(json, `Error ${res.status}`),
          });
        }
      }

      const refreshed = await reloadRecord(recordId);
      const nextBaseline = refreshed?.line_items ?? [];
      setBaselineItems(nextBaseline);

      if (failures.length > 0) {
        setSaveError(
          `Saved ${ops.length - failures.length} of ${ops.length} change(s). Failed: ${failures
            .map((f) => `${f.label}: ${f.detail}`)
            .join("; ")}. Fix and save again to retry remaining changes.`,
        );
        return;
      }

      setEditing(false);
      setSaveError(null);
      setSubmitAttempted(false);
      setFieldErrors({});
      onRecordUpdated?.();
    } catch {
      setSaveError("Could not save line item changes.");
    } finally {
      setSaveBusy(false);
    }
  }

  if (!isOpen) return null;

  const lineItems = record?.line_items ?? [];
  const status = (record?.status ?? "").toLowerCase();
  const isDraft = status === "draft";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (saveBusy) return;
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="billing-record-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <div>
            <h2
              id="billing-record-detail-title"
              className="text-lg font-semibold text-gray-900"
            >
              Billing record
            </h2>
            {!loading && record ? (
              <p className="mt-0.5 text-sm text-gray-500">
                Date of service: {formatDateOfService(record.date_of_service)}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {!loading && record && isDraft && !editing ? (
              <button
                type="button"
                onClick={startEditing}
                className={DS_SECONDARY_BTN}
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              disabled={saveBusy}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {saveError ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {saveError}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading billing record…
          </div>
        ) : record ? (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Total billed
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                  {formatUsdFromCents(record.total_billed_cents)}
                </p>
              </div>
              {record.status ? (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </p>
                  <p className="mt-1">
                    <span className={billingStatusBadgeClass(status)}>
                      {record.status}
                    </span>
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-6">
              {editing ? (
                <PiBillingLineItemsField
                  lines={editLines}
                  onChange={setEditLines}
                  fieldErrors={fieldErrors}
                  submitAttempted={submitAttempted}
                  disabled={saveBusy}
                />
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Line items
                  </h3>
                  {lineItems.length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">
                      No line items on this record.
                    </p>
                  ) : (
                    <div className={`${DS_TABLE_WRAP} mt-3`}>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead className={DS_TABLE_HEAD}>
                            <tr>
                              <th className={DS_TH}>CPT</th>
                              <th className={DS_TH}>Description</th>
                              <th className={DS_TH}>Units</th>
                              <th className={DS_TH}>Rate</th>
                              <th className={DS_TH}>Line total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineItems.map((item, idx) => {
                              const key =
                                item.id ?? `${item.cpt_code ?? "line"}-${idx}`;
                              return (
                                <tr key={key} className={DS_TR}>
                                  <td className={`${DS_TD_PRIMARY} font-mono`}>
                                    {(item.cpt_code ?? "").trim() || "—"}
                                  </td>
                                  <td className={DS_TD_PRIMARY}>
                                    {(item.description ?? "").trim() || "—"}
                                  </td>
                                  <td
                                    className={`${DS_TD_PRIMARY} tabular-nums`}
                                  >
                                    {item.units ?? "—"}
                                  </td>
                                  <td
                                    className={`${DS_TD_PRIMARY} tabular-nums`}
                                  >
                                    {formatUsdFromCents(item.rate_cents)}
                                  </td>
                                  <td
                                    className={`${DS_TD_PRIMARY} tabular-nums`}
                                  >
                                    {formatUsdFromCents(item.total_cents)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : !error ? (
          <p className="mt-6 text-sm text-gray-500">Billing record not found.</p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saveBusy}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saveBusy}
                className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2 disabled:opacity-60`}
              >
                {saveBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Saving…
                  </>
                ) : (
                  "Save"
                )}
              </button>
            </>
          ) : (
            <button type="button" onClick={onClose} className={DS_SECONDARY_BTN}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

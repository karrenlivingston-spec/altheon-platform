"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  billingStatusBadgeClass,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
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

export type BillingRecordDetailModalProps = {
  recordId: string | null;
  isOpen: boolean;
  onClose: () => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
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

export default function BillingRecordDetailModal({
  recordId,
  isOpen,
  onClose,
}: BillingRecordDetailModalProps) {
  const [record, setRecord] = useState<BillingRecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !recordId) {
      setRecord(null);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setRecord(null);
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/billing-records/${encodeURIComponent(recordId)}`,
          { headers: h },
        );
        if (cancelled) return;
        if (!res.ok) {
          const text = (await res.text().catch(() => "")).trim();
          setError(
            text || `Could not load billing record (${res.status}).`,
          );
          return;
        }
        const data = (await res.json()) as BillingRecordDetail;
        if (!cancelled) setRecord(data);
      } catch {
        if (!cancelled) setError("Could not load billing record.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, recordId]);

  if (!isOpen) return null;

  const lineItems = record?.line_items ?? [];
  const status = (record?.status ?? "").toLowerCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
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
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
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
              <h3 className="text-sm font-semibold text-gray-900">Line items</h3>
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
                            item.id ??
                            `${item.cpt_code ?? "line"}-${idx}`;
                          return (
                            <tr key={key} className={DS_TR}>
                              <td className={`${DS_TD_PRIMARY} font-mono`}>
                                {(item.cpt_code ?? "").trim() || "—"}
                              </td>
                              <td className={DS_TD_PRIMARY}>
                                {(item.description ?? "").trim() || "—"}
                              </td>
                              <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                                {item.units ?? "—"}
                              </td>
                              <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                                {formatUsdFromCents(item.rate_cents)}
                              </td>
                              <td className={`${DS_TD_PRIMARY} tabular-nums`}>
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
            </div>
          </>
        ) : !error ? (
          <p className="mt-6 text-sm text-gray-500">Billing record not found.</p>
        ) : null}

        <div className="mt-6 flex justify-end border-t border-gray-100 pt-4">
          <button type="button" onClick={onClose} className={DS_SECONDARY_BTN}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

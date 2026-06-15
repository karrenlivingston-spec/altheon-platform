"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, MoreHorizontal } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  BillingClaimRow,
  CLAIM_STATUS_OPTIONS,
  claimStatusBadgeClass,
  claimStatusLabel,
  formatUsdFromCentsPrecise,
} from "@/components/admin/billing/billingTypes";

export type ClaimsFilter =
  | "all"
  | "draft"
  | "submitted"
  | "pending"
  | "denied"
  | "paid";

type ClaimsListProps = {
  claims: BillingClaimRow[];
  total: number;
  statusCounts: Record<string, number>;
  page: number;
  pageSize: number;
  statusFilter: ClaimsFilter;
  dateFrom: string;
  dateTo: string;
  loading?: boolean;
  onStatusFilter: (status: ClaimsFilter) => void;
  onDateFrom: (value: string) => void;
  onDateTo: (value: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onView: (claim: BillingClaimRow) => void;
  onEdit: (claim: BillingClaimRow) => void;
  onDelete: (claim: BillingClaimRow) => void;
  onStatusChange: (claim: BillingClaimRow, status: string) => void;
};

const TABS: { key: ClaimsFilter; label: string; countKey: string }[] = [
  { key: "all", label: "All", countKey: "all" },
  { key: "submitted", label: "Submitted", countKey: "submitted" },
  { key: "pending", label: "Pended", countKey: "pending" },
  { key: "denied", label: "Denied", countKey: "denied" },
  { key: "paid", label: "Paid", countKey: "paid" },
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

function formatSubmitted(createdAt: string | null | undefined): string {
  if (!createdAt) return "—";
  return formatDate(createdAt);
}

export default function ClaimsList({
  claims,
  total,
  statusCounts,
  page,
  pageSize,
  statusFilter,
  dateFrom,
  dateTo,
  loading,
  onStatusFilter,
  onDateFrom,
  onDateTo,
  onPageChange,
  onPageSizeChange,
  onView,
  onEdit,
  onDelete,
  onStatusChange,
}: ClaimsListProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="text-base font-semibold text-gray-900">Claims List</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFrom(e.target.value)}
            className={`${DS_INPUT} w-auto`}
            aria-label="Date from"
          />
          <span className="text-sm text-gray-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateTo(e.target.value)}
            className={`${DS_INPUT} w-auto`}
            aria-label="Date to"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-100 pb-3">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onStatusFilter(tab.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === tab.key
                ? "bg-teal-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label} ({statusCounts[tab.countKey] ?? 0})
          </button>
        ))}
      </div>

      <div className={DS_TABLE_WRAP}>
        <table className="min-w-full divide-y divide-gray-100">
          <thead className={DS_TABLE_HEAD}>
            <tr>
              <th className={DS_TH}>Claim #</th>
              <th className={DS_TH}>Patient</th>
              <th className={DS_TH}>Payer</th>
              <th className={DS_TH}>DOS</th>
              <th className={DS_TH}>Charges</th>
              <th className={DS_TH}>Status</th>
              <th className={DS_TH}>Submitted</th>
              <th className={DS_TH}>Paid/Adjusted</th>
              <th className={DS_TH}>Balance</th>
              <th className={DS_TH}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-sm text-gray-500">
                  Loading claims…
                </td>
              </tr>
            ) : claims.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-sm text-gray-500">
                  No claims match your filters
                </td>
              </tr>
            ) : (
              claims.map((claim) => {
                const isDraft =
                  String(claim.status ?? "").toLowerCase() === "draft";
                const currentStatus = String(claim.status ?? "").toLowerCase();

                return (
                  <tr key={claim.id} className={DS_TR}>
                    <td className={`${DS_TD_PRIMARY} font-mono text-xs`}>
                      {claim.claim_number}
                    </td>
                    <td className={DS_TD_PRIMARY}>{claim.patient_name}</td>
                    <td className={DS_TD_PRIMARY}>{claim.insurance_carrier}</td>
                    <td className={DS_TD_PRIMARY}>
                      {formatDate(claim.date_of_service)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdFromCentsPrecise(claim.total_billed_cents)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <span className={claimStatusBadgeClass(claim.status)}>
                        {claimStatusLabel(claim.status)}
                      </span>
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatSubmitted(claim.created_at)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdFromCentsPrecise(claim.amount_paid_cents)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatUsdFromCentsPrecise(claim.amount_remaining_cents)}
                    </td>
                    <td className={`${DS_TD_PRIMARY} relative`}>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onView(claim)}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100"
                          aria-label="View claim"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMenuId(menuId === claim.id ? null : claim.id)
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
                              onEdit(claim);
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
                                onDelete(claim);
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
                                onStatusChange(claim, status);
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

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className={`${DS_INPUT} w-auto py-1`}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

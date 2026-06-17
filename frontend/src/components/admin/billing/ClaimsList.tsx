"use client";

import { Eye, FileText, Trash2 } from "lucide-react";

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
  onSuperbill: (claim: BillingClaimRow) => void;
  onDelete: (claim: BillingClaimRow) => void;
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

const iconBtn =
  "rounded p-1.5 text-gray-500 transition-colors hover:bg-gray-100";

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
  onSuperbill,
  onDelete,
}: ClaimsListProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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

      <div className={`${DS_TABLE_WRAP} max-w-full overflow-x-auto`}>
        <table className="min-w-[72rem] w-full divide-y divide-gray-100">
          <thead className={DS_TABLE_HEAD}>
            <tr>
              <th className={`${DS_TH} whitespace-nowrap`}>Claim #</th>
              <th className={`${DS_TH} whitespace-nowrap`}>Patient</th>
              <th className={`${DS_TH} whitespace-nowrap`}>Payer</th>
              <th className={`${DS_TH} whitespace-nowrap`}>DOS</th>
              <th className={`${DS_TH} whitespace-nowrap`}>Charges</th>
              <th className={`${DS_TH} whitespace-nowrap`}>Status</th>
              <th className={`${DS_TH} whitespace-nowrap`}>Submitted</th>
              <th className={`${DS_TH} whitespace-nowrap`}>Paid/Adjusted</th>
              <th className={`${DS_TH} whitespace-nowrap`}>Balance</th>
              <th
                className={`${DS_TH} w-24 min-w-24 whitespace-nowrap text-right`}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-6 py-12 text-center text-sm text-gray-500"
                >
                  Loading claims…
                </td>
              </tr>
            ) : claims.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-6 py-12 text-center text-sm text-gray-500"
                >
                  No claims match your filters
                </td>
              </tr>
            ) : (
              claims.map((claim) => (
                <tr key={claim.id} className={DS_TR}>
                  <td
                    className={`${DS_TD_PRIMARY} whitespace-nowrap font-mono text-xs`}
                  >
                    {claim.claim_number}
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    {claim.patient_name}
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    {claim.insurance_carrier}
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    {formatDate(claim.date_of_service)}
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    {formatUsdFromCentsPrecise(claim.total_billed_cents)}
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    <span className={claimStatusBadgeClass(claim.status)}>
                      {claimStatusLabel(claim.status)}
                    </span>
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    {formatSubmitted(claim.created_at)}
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    {formatUsdFromCentsPrecise(claim.amount_paid_cents)}
                  </td>
                  <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                    {formatUsdFromCentsPrecise(claim.amount_remaining_cents)}
                  </td>
                  <td
                    className={`${DS_TD_PRIMARY} w-24 min-w-24 whitespace-nowrap`}
                  >
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => onView(claim)}
                        className={iconBtn}
                        aria-label="View claim"
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSuperbill(claim)}
                        className={iconBtn}
                        aria-label="Generate superbill"
                        title="Superbill"
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(claim)}
                        className="rounded p-1.5 text-red-600 transition-colors hover:bg-red-50"
                        aria-label="Delete claim"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
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

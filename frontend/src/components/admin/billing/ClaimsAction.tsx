"use client";

import { ChevronRight } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  BillingDashboardData,
  formatUsdFromCents,
} from "@/components/admin/billing/billingTypes";

type ClaimsActionProps = {
  action: BillingDashboardData["claims_action"];
  onFilter?: (status: string) => void;
};

const ROWS = [
  {
    key: "denied" as const,
    emoji: "🔴",
    label: "Claims Denied",
    sub: "Action needed to resubmit",
    showAmount: true,
    filter: "denied",
  },
  {
    key: "pending" as const,
    emoji: "🟡",
    label: "Claims Pended",
    sub: "Awaiting payer response",
    showAmount: true,
    filter: "pending",
  },
  {
    key: "ready_to_send" as const,
    emoji: "🟢",
    label: "Claims Ready to Send",
    sub: "Created but not yet submitted",
    showAmount: true,
    filter: "draft",
  },
  {
    key: "unbilled" as const,
    emoji: "⚫",
    label: "Unbilled Appointments",
    sub: "Missing charges",
    showAmount: false,
    filter: "all",
  },
];

export default function ClaimsAction({ action, onFilter }: ClaimsActionProps) {
  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          Claims Requiring Action
        </h2>
        <button
          type="button"
          onClick={() => onFilter?.("all")}
          className="text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          View All →
        </button>
      </div>
      <ul className="divide-y divide-gray-100">
        {ROWS.map((row) => {
          const bucket = action[row.key];
          return (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => onFilter?.(row.filter)}
                className="flex w-full items-center gap-3 py-3 text-left text-sm hover:bg-gray-50"
              >
                <span className="text-lg" aria-hidden>
                  {row.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-gray-900">
                    {bucket.count} {row.label}
                  </span>
                  <span className="block text-xs text-gray-500">{row.sub}</span>
                </span>
                {row.showAmount && "amount_cents" in bucket ? (
                  <span className="shrink-0 font-medium text-gray-900">
                    {bucket.amount_cents && bucket.amount_cents > 0
                      ? formatUsdFromCents(bucket.amount_cents)
                      : "—"}
                  </span>
                ) : (
                  <span className="shrink-0 font-medium text-gray-900">
                    {bucket.count}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  DashboardSummary,
  formatUsdFromCents,
} from "@/components/admin/dashboard/dashboardTypes";

type ClaimsActionProps = {
  data: DashboardSummary;
};

const ROWS = [
  {
    key: "denied" as const,
    label: "Denied",
    sub: "Requires appeal or write-off",
    circle: "bg-red-500",
  },
  {
    key: "pending" as const,
    label: "Pended",
    sub: "Awaiting payer response",
    circle: "bg-amber-500",
  },
  {
    key: "ready_to_send" as const,
    label: "Ready to Send",
    sub: "Draft claims ready for submission",
    circle: "bg-green-500",
  },
  {
    key: "unbilled" as const,
    label: "Unbilled Appointments",
    sub: "Completed visits without billing",
    circle: "bg-gray-400",
  },
];

export default function ClaimsAction({ data }: ClaimsActionProps) {
  const action = data.claims_requiring_action;

  return (
    <div className={DS_CARD}>
      <h2 className="mb-4 text-base font-semibold text-gray-900">
        Claims Requiring Action
      </h2>
      <ul className="divide-y divide-gray-100">
        {ROWS.map((row) => {
          const bucket = action[row.key];
          return (
            <li key={row.key}>
              <Link
                href="/admin/billing"
                className="flex items-center gap-3 py-3 text-sm hover:bg-gray-50"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${row.circle}`}
                >
                  {bucket.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-gray-900">
                    {row.label}
                  </span>
                  <span className="block text-xs text-gray-500">{row.sub}</span>
                </span>
                <span className="shrink-0 font-medium text-gray-900">
                  {bucket.amount_cents > 0
                    ? formatUsdFromCents(bucket.amount_cents)
                    : "—"}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

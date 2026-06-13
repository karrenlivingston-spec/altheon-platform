"use client";

import { LegalRequestStats } from "@/components/admin/legal-requests/legalRequestsTypes";

type LegalRequestsStatBarProps = {
  stats: LegalRequestStats | null;
  loading?: boolean;
};

const PILLS: Array<{
  key: keyof LegalRequestStats;
  label: string;
  danger?: boolean;
}> = [
  { key: "total", label: "Total" },
  { key: "received", label: "Received" },
  { key: "gathering_records", label: "Gathering Records" },
  { key: "provider_review", label: "Provider Review" },
  { key: "ready", label: "Ready" },
  { key: "delivered", label: "Delivered" },
  { key: "overdue", label: "Overdue", danger: true },
];

export default function LegalRequestsStatBar({
  stats,
  loading,
}: LegalRequestsStatBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PILLS.map((pill) => {
        const value = loading ? "…" : String(stats?.[pill.key] ?? 0);
        return (
          <span
            key={pill.key}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              pill.danger
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-gray-200 bg-white text-gray-700"
            }`}
          >
            <span className="text-gray-500">{pill.label}</span>
            <span className={pill.danger ? "font-semibold text-red-700" : "font-semibold"}>
              {value}
            </span>
          </span>
        );
      })}
    </div>
  );
}

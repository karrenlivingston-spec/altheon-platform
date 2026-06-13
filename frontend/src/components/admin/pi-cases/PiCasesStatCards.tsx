"use client";

import { PiCaseStats, formatUsd } from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesStatCardsProps = {
  stats: PiCaseStats | null;
  loading?: boolean;
};

function Card({
  value,
  label,
  sub,
  alert,
}: {
  value: string;
  label: string;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className={`text-2xl font-bold ${alert ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      {sub ? (
        <p
          className={`mt-0.5 text-xs ${alert ? "text-red-600" : "text-gray-500"}`}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export default function PiCasesStatCards({ stats, loading }: PiCasesStatCardsProps) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Card
        value={String(stats.open_cases)}
        label="Open Cases"
        sub={`${stats.new_this_week} new this week`}
      />
      <Card
        value={String(stats.records_requested)}
        label="Records Requested"
        sub={`${stats.records_overdue} overdue`}
        alert={stats.records_overdue > 0}
      />
      <Card
        value={String(stats.records_outstanding)}
        label="Records Outstanding"
        sub={`${formatUsd(stats.amount_at_risk)} at risk`}
        alert={stats.amount_at_risk > 0}
      />
      <Card
        value={formatUsd(stats.est_settlement_value)}
        label="Est. Settlement Value"
        sub={`+${formatUsd(stats.settlement_change_this_month)} this month`}
      />
      <Card
        value={String(stats.closed_ytd)}
        label="Closed YTD"
        sub={`${stats.closed_vs_last_month >= 0 ? "+" : ""}${stats.closed_vs_last_month} vs last month`}
      />
    </div>
  );
}

"use client";

import { RecordsStats, pctTrendText } from "@/components/admin/records/recordsTypes";

type RecordsStatCardsProps = {
  stats: RecordsStats | null;
  loading?: boolean;
};

function Card({
  value,
  label,
  sub,
  alert,
  positive,
}: {
  value: string;
  label: string;
  sub?: string;
  alert?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className={`text-2xl font-bold ${alert ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      {sub ? (
        <p
          className={`mt-0.5 text-xs ${
            alert
              ? "text-red-600"
              : positive
                ? "text-green-600"
                : "text-gray-500"
          }`}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export default function RecordsStatCards({ stats, loading }: RecordsStatCardsProps) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Card
        value={String(stats.generated_this_month)}
        label="Records Generated"
        sub={pctTrendText(stats.generated_vs_last_month)}
        positive={stats.generated_vs_last_month >= 0}
      />
      <Card
        value={String(stats.pending_requests)}
        label="Pending Requests"
        sub={`${stats.pending_overdue} overdue`}
        alert={stats.pending_overdue > 0}
      />
      <Card
        value={String(stats.shared_this_month)}
        label="Records Shared"
        sub={pctTrendText(stats.shared_vs_last_month)}
        positive={stats.shared_vs_last_month >= 0}
      />
      <Card
        value={String(stats.downloads_this_month)}
        label="Downloads"
        sub="This month"
      />
      <Card
        value={`${stats.on_time_delivery_pct}%`}
        label="On-Time Delivery"
        sub="This month"
        positive
      />
    </div>
  );
}

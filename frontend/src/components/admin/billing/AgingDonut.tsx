"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  BillingDashboardData,
  formatUsdFromCents,
} from "@/components/admin/billing/billingTypes";

type AgingDonutProps = {
  aging: BillingDashboardData["aging"];
};

const BUCKET_META = [
  { key: "bucket_0_30" as const, label: "0–30 days", color: "#16a34a" },
  { key: "bucket_31_60" as const, label: "31–60 days", color: "#eab308" },
  { key: "bucket_61_90" as const, label: "61–90 days", color: "#f97316" },
  { key: "bucket_90_plus" as const, label: "90+ days", color: "#dc2626" },
];

export default function AgingDonut({ aging }: AgingDonutProps) {
  const slices = BUCKET_META.map((b) => ({
    name: b.label,
    value: aging[b.key],
    color: b.color,
  })).filter((s) => s.value > 0);

  const total = aging.total;
  const isEmpty = total === 0;
  const chartData = isEmpty
    ? [{ name: "Empty", value: 1, color: "#e5e7eb" }]
    : slices.length > 0
      ? slices
      : [{ name: "Empty", value: 1, color: "#e5e7eb" }];

  return (
    <div className={DS_CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Aging Receivables</h2>
        <span className="text-xs font-medium text-teal-600">View Aging Report →</span>
      </div>
      <div className="relative h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={72}
              paddingAngle={isEmpty ? 0 : 2}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            {!isEmpty ? (
              <Tooltip
                formatter={(v: unknown) => formatUsdFromCents(Number(v))}
                contentStyle={{ fontSize: 12 }}
              />
            ) : null}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          {isEmpty ? (
            <span className="text-xs font-medium text-gray-500">No outstanding AR</span>
          ) : (
            <>
              <span className="text-xs text-gray-500">Total Outstanding</span>
              <span className="text-sm font-bold text-gray-900">
                {formatUsdFromCents(total)}
              </span>
            </>
          )}
        </div>
      </div>
      {!isEmpty ? (
        <ul className="mt-2 space-y-1 text-xs">
          {slices.map((s) => (
            <li key={s.name} className="flex justify-between text-gray-600">
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.name}
              </span>
              <span>
                {formatUsdFromCents(s.value)} (
                {Math.round((s.value / total) * 100)}%)
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

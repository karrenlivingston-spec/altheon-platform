"use client";

import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  AGING_BUCKET_META,
  BillingDashboardData,
  formatUsdFromCents,
} from "@/components/admin/billing/billingTypes";

type AgingDonutProps = {
  aging: BillingDashboardData["aging"];
  reportHref?: string;
  title?: string;
  showLegend?: boolean;
  className?: string;
};

export default function AgingDonut({
  aging,
  reportHref,
  title = "Aging Receivables",
  showLegend = true,
  className,
}: AgingDonutProps) {
  const slices = AGING_BUCKET_META.map((b) => ({
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

  const reportLink = reportHref ? (
    <Link
      href={reportHref}
      className="text-xs font-medium text-teal-600 hover:text-teal-700"
    >
      View Aging Report →
    </Link>
  ) : (
    <span className="text-xs font-medium text-teal-600">View Aging Report →</span>
  );

  return (
    <div className={className ?? DS_CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {reportLink}
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
      {showLegend && !isEmpty ? (
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

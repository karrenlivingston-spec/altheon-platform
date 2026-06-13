"use client";

import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  DashboardSummary,
  formatUsdFromCents,
} from "@/components/admin/dashboard/dashboardTypes";

type CollectionsDonutProps = {
  data: DashboardSummary;
};

export default function CollectionsDonut({ data }: CollectionsDonutProps) {
  const paid = data.collections_mtd_cents;
  const total = data.total_billed_mtd_cents;
  const pending = Math.max(0, total - paid);
  const denied = data.claims_requiring_action.denied.amount_cents;

  const slices = [
    { name: "Paid", value: paid, color: "#16a34a" },
    { name: "Pending", value: pending, color: "#f59e0b" },
    { name: "Overdue", value: denied, color: "#dc2626" },
  ].filter((s) => s.value > 0);

  const chartData = slices.length > 0 ? slices : [{ name: "No data", value: 1, color: "#e5e7eb" }];
  const sum = slices.reduce((a, s) => a + s.value, 0) || 1;

  return (
    <div className={DS_CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Collections</h3>
        <Link
          href="/admin/billing"
          className="text-xs font-medium text-teal-600 hover:text-teal-700"
        >
          View Billing →
        </Link>
      </div>
      <div className="relative h-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={58}
              paddingAngle={2}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: unknown) => formatUsdFromCents(Number(v))}
              contentStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-gray-500">MTD Billed</span>
          <span className="text-sm font-bold text-gray-900">
            {formatUsdFromCents(total)}
          </span>
        </div>
      </div>
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
              {formatUsdFromCents(s.value)} ({Math.round((s.value / sum) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

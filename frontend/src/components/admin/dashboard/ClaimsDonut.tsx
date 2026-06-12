"use client";

import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import { DashboardSummary } from "@/components/admin/dashboard/dashboardTypes";

const COLORS: Record<string, string> = {
  Paid: "#16a34a",
  Pending: "#f59e0b",
  Denied: "#dc2626",
  Submitted: "#3b82f6",
};

type ClaimsDonutProps = {
  data: DashboardSummary;
};

export default function ClaimsDonut({ data }: ClaimsDonutProps) {
  const cs = data.claims_summary;
  const slices = [
    { name: "Paid", value: cs.paid },
    { name: "Pending", value: cs.pending },
    { name: "Denied", value: cs.denied },
    { name: "Submitted", value: cs.submitted },
  ].filter((s) => s.value > 0);

  const total = slices.reduce((a, s) => a + s.value, 0);
  const chartData =
    slices.length > 0 ? slices : [{ name: "No claims", value: 1 }];

  return (
    <div className={DS_CARD}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Claims</h3>
        <Link
          href="/admin/billing"
          className="text-xs font-medium text-teal-600 hover:text-teal-700"
        >
          Go to Billing →
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
                <Cell
                  key={entry.name}
                  fill={COLORS[entry.name] ?? "#9ca3af"}
                />
              ))}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-gray-500">Total Claims</span>
          <span className="text-sm font-bold text-gray-900">{total}</span>
        </div>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {slices.map((s) => (
          <li key={s.name} className="flex justify-between text-gray-600">
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: COLORS[s.name] }}
              />
              {s.name}
            </span>
            <span>
              {s.value}
              {total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

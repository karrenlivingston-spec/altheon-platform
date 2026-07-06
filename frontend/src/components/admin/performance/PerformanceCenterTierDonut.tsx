"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  APS_TIER_CHART_COLORS,
  type ApsTierCounts,
  apsTierCountShortLabel,
  tierCountsTotal,
} from "@/components/admin/performance/apsTypes";

const TIER_ORDER = ["high", "moderate", "low"] as const;

type PerformanceCenterTierDonutProps = {
  counts: ApsTierCounts;
  loading?: boolean;
};

export default function PerformanceCenterTierDonut({
  counts,
  loading,
}: PerformanceCenterTierDonutProps) {
  const data = TIER_ORDER.map((tier) => ({
    name: apsTierCountShortLabel(tier),
    tier,
    value: counts[tier] ?? 0,
    color: APS_TIER_CHART_COLORS[tier],
  })).filter((d) => d.value > 0);

  const totalTiered = tierCountsTotal(counts);
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  return (
    <div className={DS_CARD}>
      <h3 className="text-sm font-semibold text-gray-900">Pattern tiers</h3>
      <p className="mt-0.5 text-xs text-gray-500">
        Sessions with an overall asymmetry pattern tier
      </p>
      {loading ? (
        <p className="mt-8 py-12 text-center text-sm text-gray-500">Loading chart…</p>
      ) : totalTiered === 0 ? (
        <p className="mt-8 py-12 text-center text-sm text-gray-500">
          No tiered pattern sessions yet
        </p>
      ) : (
        <>
          <div className="relative mx-auto mt-4 h-48 w-full max-w-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.length ? data : [{ name: "None", value: 1, color: "#e5e7eb" }]}
                  dataKey="value"
                  innerRadius={52}
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {(data.length ? data : [{ color: "#e5e7eb" }]).map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-2xl font-bold text-gray-900">{totalTiered}</p>
              <p className="text-xs text-gray-500">sessions</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {TIER_ORDER.map((tier) => {
              const v = counts[tier] ?? 0;
              const pct = Math.round((v / total) * 100);
              return (
                <li
                  key={tier}
                  className="flex items-center justify-between text-xs text-gray-600"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: APS_TIER_CHART_COLORS[tier] }}
                    />
                    {apsTierCountShortLabel(tier)}
                  </span>
                  <span>
                    {v} ({pct}%)
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

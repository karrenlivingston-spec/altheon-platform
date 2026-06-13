"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import { KANBAN_COLUMNS, PiCaseStats } from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesDonutChartProps = {
  stats: PiCaseStats | null;
  loading?: boolean;
};

export default function PiCasesDonutChart({ stats, loading }: PiCasesDonutChartProps) {
  const counts = stats?.status_counts ?? {};
  const data = KANBAN_COLUMNS.map((c) => ({
    name: c.label,
    value: counts[c.id] ?? 0,
    color: c.chartColor,
  })).filter((d) => d.value > 0);

  const totalOpen = stats?.open_cases ?? 0;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  return (
    <div className={DS_CARD}>
      <h3 className="text-sm font-semibold text-gray-900">Case Summary</h3>
      {loading ? (
        <p className="mt-8 py-12 text-center text-sm text-gray-500">Loading chart…</p>
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
              <p className="text-2xl font-bold text-gray-900">{totalOpen}</p>
              <p className="text-xs text-gray-500">open cases</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {KANBAN_COLUMNS.map((c) => {
              const v = counts[c.id] ?? 0;
              const pct = Math.round((v / total) * 100);
              return (
                <li key={c.id} className="flex items-center justify-between text-xs text-gray-600">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: c.chartColor }}
                    />
                    {c.label}
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

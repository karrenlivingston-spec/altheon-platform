"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import { type ApsTestingVolumePoint } from "@/components/admin/performance/apsTypes";

type PerformanceCenterTestingVolumeChartProps = {
  data: ApsTestingVolumePoint[];
  loading?: boolean;
};

function formatAxisDate(iso: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${iso}T12:00:00`));
}

export default function PerformanceCenterTestingVolumeChart({
  data,
  loading,
}: PerformanceCenterTestingVolumeChartProps) {
  const chartData = data.map((row) => ({
    ...row,
    label: formatAxisDate(row.date),
  }));

  return (
    <div className={DS_CARD}>
      <h3 className="text-sm font-semibold text-gray-900">Testing Volume</h3>
      <p className="mt-0.5 text-xs text-gray-500">Kinvent sessions in the last 8 weeks</p>
      {loading ? (
        <p className="py-16 text-center text-sm text-gray-500">Loading chart…</p>
      ) : chartData.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500">
          No sessions in the last 8 weeks
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#9ca3af", fontSize: 11 }}
              width={28}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as ApsTestingVolumePoint & { label: string };
                return (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
                    <p className="font-medium text-gray-900">{p.label}</p>
                    <p className="text-gray-600">
                      {p.count} session{p.count === 1 ? "" : "s"}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

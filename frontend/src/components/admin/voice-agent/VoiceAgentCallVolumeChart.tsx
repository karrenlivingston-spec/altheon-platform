"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import { CallVolumePoint } from "@/components/admin/voice-agent/voiceAgentTypes";

type VoiceAgentCallVolumeChartProps = {
  data: CallVolumePoint[];
  days: number;
  onDaysChange: (days: number) => void;
  loading?: boolean;
};

const RANGE_OPTIONS = [
  { value: 7, label: "Last 7 Days" },
  { value: 30, label: "Last 30 Days" },
  { value: 90, label: "Last 90 Days" },
];

export default function VoiceAgentCallVolumeChart({
  data,
  days,
  onDaysChange,
  loading,
}: VoiceAgentCallVolumeChartProps) {
  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Call Volume</h3>
        <select
          value={days}
          onChange={(e) => onDaysChange(Number(e.target.value))}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-gray-500">Loading chart…</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="callVolumeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#16a34a" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
            <XAxis
              dataKey="date"
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
                const p = payload[0]?.payload as CallVolumePoint;
                return (
                  <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm shadow-md">
                    <p className="font-medium text-gray-900">{p.date}</p>
                    <p className="text-gray-600">
                      Calls: <span className="font-semibold">{p.calls}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="calls"
              stroke="#16a34a"
              strokeWidth={2}
              fill="url(#callVolumeFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

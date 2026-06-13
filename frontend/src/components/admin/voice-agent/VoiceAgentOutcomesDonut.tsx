"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import { VoiceOutcomes } from "@/components/admin/voice-agent/voiceAgentTypes";

type VoiceAgentOutcomesDonutProps = {
  outcomes: VoiceOutcomes | null;
  loading?: boolean;
};

export default function VoiceAgentOutcomesDonut({
  outcomes,
  loading,
}: VoiceAgentOutcomesDonutProps) {
  const data =
    outcomes?.breakdown.filter((b) => b.value > 0) ?? [];
  const total = outcomes?.total ?? 0;

  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Call Outcomes (Last 7 Days)
        </h3>
        <button type="button" className="text-xs font-medium text-emerald-700 hover:underline">
          View Full Report →
        </button>
      </div>
      {loading ? (
        <p className="py-16 text-center text-sm text-gray-500">Loading chart…</p>
      ) : (
        <>
          <div className="relative mx-auto h-44 w-full max-w-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={
                    data.length
                      ? data.map((d) => ({
                          name: d.label,
                          value: d.value,
                          color: d.color,
                        }))
                      : [{ name: "None", value: 1, color: "#e5e7eb" }]
                  }
                  dataKey="value"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={2}
                >
                  {(data.length
                    ? data
                    : [{ color: "#e5e7eb", label: "", value: 1 }]
                  ).map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-2xl font-bold text-gray-900">{total}</p>
              <p className="text-xs text-gray-500">Total Calls</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {(outcomes?.breakdown ?? []).map((b) => (
              <li
                key={b.label}
                className="flex items-center justify-between text-xs text-gray-600"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: b.color }}
                  />
                  {b.label}
                </span>
                <span>
                  {b.value} ({b.pct}%)
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

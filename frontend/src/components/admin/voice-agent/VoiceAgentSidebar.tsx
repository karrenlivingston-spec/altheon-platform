"use client";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  REASON_ICONS,
  TopCallReason,
  VoicePerformance,
} from "@/components/admin/voice-agent/voiceAgentTypes";

type VoiceAgentSidebarProps = {
  reasons: TopCallReason[];
  performance: VoicePerformance | null;
  loading?: boolean;
};

function trendLabel(delta: number, suffix = ""): string {
  if (delta > 0) return `↑ ${Math.abs(delta)}${suffix}`;
  if (delta < 0) return `↓ ${Math.abs(delta)}${suffix}`;
  return "—";
}

export default function VoiceAgentSidebar({
  reasons,
  performance,
  loading,
}: VoiceAgentSidebarProps) {
  const maxCount = Math.max(...reasons.map((r) => r.count), 1);

  return (
    <div className="space-y-4 xl:sticky xl:top-4">
      <div className={DS_CARD}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Top Call Reasons</h3>
          <span className="text-xs text-gray-500">Last 7 days</span>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
        ) : (
          <ul className="space-y-3">
            {reasons.map((r) => (
              <li key={r.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-gray-700">
                    <span aria-hidden>{REASON_ICONS[r.label] ?? "📞"}</span>
                    {r.label}
                  </span>
                  <span className="text-xs text-gray-500">
                    {r.count} ({r.pct}%)
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-[#16a34a]"
                    style={{ width: `${(r.count / maxCount) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={DS_CARD}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Aria Performance</h3>
          <span className="text-xs text-gray-500">Last 7 days</span>
        </div>
        {loading || !performance ? (
          <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <p className="text-xl font-bold text-gray-900">
                  {performance.call_answer_rate_pct}%
                </p>
                <p className="text-[10px] text-gray-500">Answer Rate</p>
                <p className="mt-0.5 text-[10px] text-green-600">
                  {trendLabel(performance.answer_rate_vs_last_period, "%")}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <p className="text-xl font-bold text-gray-900">
                  {performance.patient_satisfaction}
                  <span className="text-sm text-amber-500"> ★</span>
                </p>
                <p className="text-[10px] text-gray-500">Satisfaction</p>
                <p className="mt-0.5 text-[10px] text-green-600">
                  {trendLabel(performance.satisfaction_vs_last)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-3">
                <p className="text-xl font-bold text-gray-900">
                  {performance.avg_answer_time_seconds}s
                </p>
                <p className="text-[10px] text-gray-500">Answer Time</p>
                <p className="mt-0.5 text-[10px] text-green-600">
                  {trendLabel(performance.answer_time_vs_last, "s")}
                </p>
              </div>
            </div>
            <p className="mt-4 text-center text-xs text-gray-500">
              Aria is learning and improving every day.
            </p>
            <button
              type="button"
              className="mt-2 block w-full text-center text-xs font-medium text-emerald-700 hover:underline"
            >
              View Insights →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

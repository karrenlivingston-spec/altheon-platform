"use client";

import {
  VoiceAgentStats,
  formatDuration,
  trendText,
} from "@/components/admin/voice-agent/voiceAgentTypes";

type VoiceAgentStatCardsProps = {
  stats: VoiceAgentStats | null;
  loading?: boolean;
};

function StatCard({
  value,
  label,
  sub,
  alert,
}: {
  value: string;
  label: string;
  sub?: string;
  alert?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className={`text-2xl font-bold ${alert ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      {sub ? (
        <p
          className={`mt-0.5 text-xs ${
            alert ? "text-red-600" : sub.startsWith("↑") ? "text-green-600" : sub.startsWith("↓") && label.includes("Missed") ? "text-green-600" : "text-gray-500"
          }`}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export default function VoiceAgentStatCards({ stats, loading }: VoiceAgentStatCardsProps) {
  if (loading || !stats) {
    return (
      <>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </>
    );
  }

  const callsTrend = trendText(stats.calls_today_vs_yesterday);
  const bookedTrend = trendText(stats.appointments_booked_vs_yesterday);
  const missedTrend = trendText(stats.missed_vs_yesterday, { invert: true });
  const convTrend = trendText(stats.conversion_vs_yesterday, { suffix: "%" });
  const durTrend = trendText(stats.avg_duration_vs_yesterday, {
    suffix: "s",
    invert: true,
  });

  return (
    <>
      <StatCard
        value={String(stats.calls_today)}
        label="Calls Today"
        sub={callsTrend.text}
      />
      <StatCard
        value={String(stats.appointments_booked)}
        label="Appointments Booked"
        sub={bookedTrend.text}
      />
      <StatCard
        value={String(stats.missed_calls)}
        label="Missed Calls"
        sub={missedTrend.text}
        alert={stats.missed_calls > 0}
      />
      <StatCard
        value={`${stats.booking_conversion_pct}%`}
        label="Booking Conversion"
        sub={convTrend.text}
      />
      <StatCard
        value={formatDuration(stats.avg_duration_seconds)}
        label="Avg Call Duration"
        sub={durTrend.text}
      />
    </>
  );
}

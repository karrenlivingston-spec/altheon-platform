"use client";

import { AppointmentStats } from "@/components/admin/appointments/appointmentsTypes";

type AppointmentsStatCardsProps = {
  stats: AppointmentStats | null;
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
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className={`text-2xl font-bold ${alert ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
    </div>
  );
}

export default function AppointmentsStatCards({
  stats,
  loading,
}: AppointmentsStatCardsProps) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <StatCard
        value={String(stats.appointments_today)}
        label="Appointments Today"
        sub={`${stats.upcoming_count} upcoming`}
      />
      <StatCard
        value={String(stats.scheduled)}
        label="Scheduled"
        sub={`${stats.scheduled_pct}% of today`}
      />
      <StatCard
        value={String(stats.no_shows)}
        label="No Shows"
        sub={`${stats.no_shows_week} this week`}
        alert={stats.no_shows > 0}
      />
      <StatCard
        value={`${stats.utilization_pct}%`}
        label="Utilization"
        sub="All providers"
      />
      <StatCard
        value={`${stats.avg_visit_duration_min} min`}
        label="Avg Visit Duration"
        sub={`${stats.avg_visit_duration_week_min} min this week`}
      />
    </div>
  );
}

"use client";

import {
  ClinicsDashboardStats,
  formatUsd,
  pctTrend,
} from "@/components/admin/clinics/clinicsTypes";

type ClinicsStatCardsProps = {
  stats: ClinicsDashboardStats | null;
  loading?: boolean;
};

function Card({
  value,
  label,
  sub,
  positive,
}: {
  value: string;
  label: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      {sub ? (
        <p
          className={`mt-0.5 text-xs ${
            positive === false ? "text-gray-500" : positive ? "text-green-600" : "text-gray-500"
          }`}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export default function ClinicsStatCards({ stats, loading }: ClinicsStatCardsProps) {
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

  const patientsTrend = pctTrend(stats.patients_vs_last_month);
  const apptsTrend = pctTrend(stats.appointments_vs_last_month);
  const collectedTrend = pctTrend(stats.collected_vs_last_month);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Card
        value={String(stats.total_clinics)}
        label="Total Clinics"
        sub={`${stats.active_clinics} active • ${stats.inactive_clinics} inactive`}
      />
      <Card
        value={stats.total_patients.toLocaleString()}
        label="Total Patients"
        sub={patientsTrend.text}
        positive={patientsTrend.positive}
      />
      <Card
        value={stats.appointments_mtd.toLocaleString()}
        label="Appointments MTD"
        sub={apptsTrend.text}
        positive={apptsTrend.positive}
      />
      <Card
        value={formatUsd(stats.collected_mtd)}
        label="Collected MTD"
        sub={collectedTrend.text}
        positive={collectedTrend.positive}
      />
      <Card
        value={`${stats.avg_collection_rate_pct}%`}
        label="Avg Collection Rate"
        sub="Across live clinics"
        positive
      />
    </div>
  );
}

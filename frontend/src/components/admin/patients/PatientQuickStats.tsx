"use client";

import { PatientHeaderStats, formatUsdFromCents } from "@/components/admin/patients/patientTypes";

type PatientQuickStatsProps = {
  stats: PatientHeaderStats | null;
  loading?: boolean;
};

function StatCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
    </div>
  );
}

export default function PatientQuickStats({ stats, loading }: PatientQuickStatsProps) {
  if (loading || !stats) {
    return (
      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse bg-white" />
        ))}
      </div>
    );
  }

  const nextAppt =
    stats.next_appointment_date && stats.next_appointment_time
      ? `${stats.next_appointment_date}, ${stats.next_appointment_time}`
      : stats.next_appointment_date ?? "—";

  const balance =
    stats.balance_due_cents > 0
      ? formatUsdFromCents(stats.balance_due_cents)
      : "$0.00";

  return (
    <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 md:grid-cols-3 xl:grid-cols-6">
      <StatCell
        label="Insurance Status"
        value={stats.insurance_status}
        sub={stats.insurance_carrier}
      />
      <StatCell
        label="Last Visit"
        value={stats.last_visit_date ?? "—"}
        sub={stats.last_visit_clinician}
      />
      <StatCell
        label="Next Appointment"
        value={nextAppt}
        sub={stats.next_appointment_clinician}
      />
      <StatCell label="Balance Due" value={balance} />
      <StatCell label="Care Plan" value={stats.care_plan_label} />
      <StatCell
        label="Patient Since"
        value={stats.patient_since ?? "—"}
      />
    </div>
  );
}

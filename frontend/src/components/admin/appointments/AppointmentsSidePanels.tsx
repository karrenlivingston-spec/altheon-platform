"use client";

import Link from "next/link";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  AppointmentTasks,
  AriaStats,
  ClinicianUtilization,
  STATUS_STYLES,
  UpcomingItem,
  statusLabel,
} from "@/components/admin/appointments/appointmentsTypes";

type AppointmentsSidePanelsProps = {
  tasks: AppointmentTasks | null;
  utilization: ClinicianUtilization[];
  aria: AriaStats | null;
  upcoming: UpcomingItem[];
  loading?: boolean;
};

function utilBarColor(pct: number): string {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 60) return "bg-amber-500";
  return "bg-red-500";
}

export default function AppointmentsSidePanels({
  tasks,
  utilization,
  aria,
  upcoming,
  loading,
}: AppointmentsSidePanelsProps) {
  const taskRows = [
    { key: "intakes_pending", label: "Intakes Pending", color: "bg-orange-100 text-orange-800" },
    {
      key: "consent_forms_missing",
      label: "Consent Forms Missing",
      color: "bg-amber-100 text-amber-800",
    },
    {
      key: "insurance_verifications",
      label: "Insurance Verification",
      color: "bg-blue-100 text-blue-800",
    },
    {
      key: "claims_ready",
      label: "Claims Ready to Submit",
      color: "bg-green-100 text-green-800",
    },
  ] as const;

  return (
    <div className="space-y-4">
      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Today&apos;s Tasks</h3>
        <ul className="mt-3 space-y-2">
          {taskRows.map((row) => (
            <li key={row.key} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{row.label}</span>
              <span
                className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${row.color}`}
              >
                {loading ? "…" : (tasks?.[row.key] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-3 text-xs font-medium text-emerald-700 hover:underline"
        >
          View All Tasks →
        </button>
      </div>

      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Provider Utilization</h3>
        <div className="mt-3 space-y-3">
          {utilization.length === 0 ? (
            <p className="text-sm text-gray-500">No provider data.</p>
          ) : (
            utilization.map((u) => (
              <div key={u.clinician_id}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-900">
                    {u.clinician_name}
                    {u.credentials ? (
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        {u.credentials}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs font-semibold text-gray-700">
                    {u.utilization_pct}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-1.5 rounded-full ${utilBarColor(u.utilization_pct)}`}
                    style={{ width: `${u.utilization_pct}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          className="mt-3 text-xs font-medium text-emerald-700 hover:underline"
        >
          View Full Report →
        </button>
      </div>

      <div className={DS_CARD}>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Aria Scheduling Assistant</h3>
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Online
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Calls Today", aria?.calls_today ?? 0],
            ["Appointments Booked", aria?.appointments_booked ?? 0],
            ["Reschedules", aria?.reschedules ?? 0],
            ["Missed Calls", aria?.missed_calls ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="text-center">
              <p className="text-lg font-bold text-gray-900">{loading ? "…" : value}</p>
              <p className="text-[10px] text-gray-500">{label}</p>
            </div>
          ))}
        </div>
        <Link
          href="/admin/voice-agent"
          className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline"
        >
          View Call Log →
        </Link>
      </div>

      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Upcoming Appointments</h3>
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming appointments.</p>
          ) : (
            upcoming.map((u) => (
              <div
                key={u.id}
                className="min-w-[140px] shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-3"
              >
                <p className="text-xs font-semibold text-emerald-700">
                  {u.day_label} {u.date_label}
                </p>
                <p className="mt-1 text-sm font-medium text-gray-900">{u.start_time}</p>
                <p className="truncate text-sm text-gray-800">{u.patient_name}</p>
                <p className="truncate text-xs text-gray-500">{u.treatment_type}</p>
                <p className="truncate text-xs text-gray-400">{u.clinician_name}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Status Legend</h3>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {Object.entries(STATUS_STYLES)
            .filter(([k]) => k !== "completed")
            .map(([key, style]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 text-xs text-gray-600"
              >
                <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                {statusLabel(key)}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

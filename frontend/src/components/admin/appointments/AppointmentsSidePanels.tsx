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

const SIDEBAR_CARD = `${DS_CARD} !p-3.5`;

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
    <div className="space-y-3">
      <div className={SIDEBAR_CARD}>
        <h3 className="text-xs font-semibold text-gray-900">Today&apos;s Tasks</h3>
        <ul className="mt-2 space-y-1.5">
          {taskRows.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-gray-700">{row.label}</span>
              <span
                className={`inline-flex shrink-0 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${row.color}`}
              >
                {loading ? "…" : (tasks?.[row.key] ?? 0)}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-2 text-[11px] font-medium text-emerald-700 hover:underline"
        >
          View All Tasks →
        </button>
      </div>

      <div className={SIDEBAR_CARD}>
        <h3 className="text-xs font-semibold text-gray-900">Provider Utilization</h3>
        <div className="mt-2 space-y-2.5">
          {utilization.length === 0 ? (
            <p className="text-xs text-gray-500">No provider data.</p>
          ) : (
            utilization.map((u) => (
              <div key={u.clinician_id}>
                <div className="flex items-baseline justify-between gap-1 text-xs">
                  <span className="min-w-0 truncate font-medium text-gray-900">
                    {u.clinician_name}
                    {u.credentials ? (
                      <span className="ml-0.5 text-[10px] font-normal text-gray-500">
                        {u.credentials}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold text-gray-700">
                    {u.utilization_pct}%
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-1 rounded-full ${utilBarColor(u.utilization_pct)}`}
                    style={{ width: `${u.utilization_pct}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          className="mt-2 text-[11px] font-medium text-emerald-700 hover:underline"
        >
          View Full Report →
        </button>
      </div>

      <div className={SIDEBAR_CARD}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-xs font-semibold text-gray-900">Aria Scheduling Assistant</h3>
          <span className="inline-flex items-center gap-1 text-[10px] text-green-700">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Online
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            ["Calls Today", aria?.calls_today ?? 0],
            ["Appointments Booked", aria?.appointments_booked ?? 0],
            ["Reschedules", aria?.reschedules ?? 0],
            ["Missed Calls", aria?.missed_calls ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-gray-50 px-2 py-1.5 text-center">
              <p className="text-base font-bold leading-tight text-gray-900">
                {loading ? "…" : value}
              </p>
              <p className="text-[9px] leading-snug text-gray-500">{label}</p>
            </div>
          ))}
        </div>
        <Link
          href="/admin/voice-agent"
          className="mt-2 inline-block text-[11px] font-medium text-emerald-700 hover:underline"
        >
          View Call Log →
        </Link>
      </div>

      <div className={SIDEBAR_CARD}>
        <h3 className="text-xs font-semibold text-gray-900">Upcoming Appointments</h3>
        <div className="mt-2 space-y-2">
          {upcoming.length === 0 ? (
            <p className="text-xs text-gray-500">No upcoming appointments.</p>
          ) : (
            upcoming.map((u) => (
              <div
                key={u.id}
                className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2"
              >
                <p className="text-[10px] font-semibold text-emerald-700">
                  {u.day_label} {u.date_label} · {u.start_time}
                </p>
                <p className="mt-0.5 truncate text-xs font-medium text-gray-900">
                  {u.patient_name}
                </p>
                <p className="truncate text-[10px] text-gray-500">
                  {u.treatment_type} · {u.clinician_name}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={SIDEBAR_CARD}>
        <h3 className="text-xs font-semibold text-gray-900">Status Legend</h3>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
          {Object.entries(STATUS_STYLES)
            .filter(([k]) => k !== "completed")
            .map(([key, style]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 text-[10px] text-gray-600"
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                {statusLabel(key)}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

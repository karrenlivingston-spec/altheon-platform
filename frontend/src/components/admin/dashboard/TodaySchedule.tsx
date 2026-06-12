"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import { formatTimeEastern } from "@/components/adminEastern";
import { ScheduleRow } from "@/components/admin/dashboard/dashboardTypes";

function statusBadge(status: string) {
  const s = status.toLowerCase();
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (s === "confirmed") return `${base} bg-green-50 text-green-700`;
  if (s === "scheduled") return `${base} bg-gray-100 text-gray-600`;
  if (s === "needs_intake") return `${base} bg-amber-50 text-amber-700`;
  if (s === "no_show") return `${base} bg-red-50 text-red-600`;
  if (s === "completed") return `${base} bg-gray-200 text-gray-700`;
  if (s === "checked_in") return `${base} bg-teal-50 text-teal-700`;
  return `${base} bg-gray-100 text-gray-600`;
}

function statusLabel(status: string) {
  if (status === "needs_intake") return "Needs Intake";
  return status.replace(/_/g, " ");
}

type TodayScheduleProps = {
  rows: ScheduleRow[];
  totalToday: number;
};

export default function TodaySchedule({ rows, totalToday }: TodayScheduleProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, 6);
  const more = totalToday - 6;

  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Today&apos;s Schedule</h2>
        <Link
          href="/admin/appointments"
          className="text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          View Calendar →
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          No appointments scheduled for today
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {visible.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 py-3 text-sm sm:grid-cols-[5rem_1fr_1fr_1fr_auto]"
            >
              <span className="font-medium text-gray-900">
                {formatTimeEastern(row.start_time)}
              </span>
              <span className="truncate font-medium text-gray-900">
                {row.patient_name}
              </span>
              <span className="hidden truncate text-gray-500 sm:block">
                {row.treatment_type}
              </span>
              <span className="hidden truncate text-gray-500 sm:block">
                {row.clinician_name}
              </span>
              <span className={statusBadge(row.status)}>
                {statusLabel(row.status)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!expanded && more > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 flex w-full items-center justify-center gap-1 text-sm text-teal-600 hover:text-teal-700"
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
          {more} more appointment{more === 1 ? "" : "s"}
        </button>
      ) : null}
      {expanded && rows.length > 6 ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 flex w-full items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ChevronRight className="h-4 w-4 rotate-90" aria-hidden />
          Show less
        </button>
      ) : null}
    </div>
  );
}

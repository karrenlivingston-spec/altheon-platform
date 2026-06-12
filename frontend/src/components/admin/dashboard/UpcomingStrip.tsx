"use client";

import Link from "next/link";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import { formatTimeEastern } from "@/components/adminEastern";
import { ScheduleRow } from "@/components/admin/dashboard/dashboardTypes";

function statusDot(status: string) {
  const s = status.toLowerCase();
  if (s === "confirmed" || s === "checked_in") return "bg-green-500";
  if (s === "no_show") return "bg-red-500";
  if (s === "needs_intake") return "bg-amber-500";
  return "bg-gray-400";
}

function formatDateBadge(iso: string): { day: string; month: string } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    day: "numeric",
  }).format(d);
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
  }).format(d);
  return { day, month };
}

type UpcomingStripProps = {
  rows: ScheduleRow[];
};

export default function UpcomingStrip({ rows }: UpcomingStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * 280, behavior: "smooth" });
  }

  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-gray-900">
          Upcoming Appointments
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scroll(-1)}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50"
            aria-label="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <Link
            href="/admin/appointments"
            className="ml-2 text-sm font-medium text-teal-600 hover:text-teal-700"
          >
            View Full Calendar →
          </Link>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          No upcoming appointments in the next 7 days
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin"
        >
          {rows.map((row) => {
            const badge = formatDateBadge(row.start_time);
            return (
              <div
                key={row.id}
                className="min-w-[220px] shrink-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="rounded-lg bg-teal-50 px-2 py-1 text-center">
                    <p className="text-xs font-medium uppercase text-teal-700">
                      {badge.month}
                    </p>
                    <p className="text-lg font-bold leading-none text-teal-900">
                      {badge.day}
                    </p>
                  </div>
                  <span
                    className={`mt-1 h-2.5 w-2.5 rounded-full ${statusDot(row.status)}`}
                    title={row.status}
                  />
                </div>
                <p className="text-sm font-semibold text-gray-900">
                  {formatTimeEastern(row.start_time)}
                </p>
                <p className="mt-1 truncate text-sm text-gray-900">
                  {row.patient_name}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {row.treatment_type}
                </p>
                <p className="truncate text-xs text-gray-400">
                  {row.clinician_name}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

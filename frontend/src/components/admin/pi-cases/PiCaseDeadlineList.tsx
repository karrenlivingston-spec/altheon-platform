"use client";

import { PiCaseDeadline } from "@/components/admin/pi-cases/piCasesTypes";

export function PiCaseDeadlineRow({ deadline }: { deadline: PiCaseDeadline }) {
  const parts = deadline.date.split(" ");
  return (
    <li className="flex gap-3">
      <div
        className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg text-center text-[10px] font-bold ${
          deadline.is_overdue ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"
        }`}
      >
        <span>{parts[0]?.toUpperCase()}</span>
        <span className="text-sm">{parts[1]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{deadline.label}</p>
        <p className="text-xs text-gray-500">{deadline.subtitle}</p>
        <p
          className={`text-xs font-medium ${
            deadline.is_overdue ? "text-red-600" : "text-green-600"
          }`}
        >
          {deadline.is_overdue ? "Overdue" : `${deadline.days_until} days`}
        </p>
      </div>
    </li>
  );
}

type PiCaseDeadlineListProps = {
  deadlines: PiCaseDeadline[];
  loading?: boolean;
  emptyMessage?: string;
};

export function PiCaseDeadlineList({
  deadlines,
  loading,
  emptyMessage = "No upcoming deadlines.",
}: PiCaseDeadlineListProps) {
  if (loading) {
    return <li className="text-sm text-gray-500">Loading…</li>;
  }
  if (deadlines.length === 0) {
    return <li className="text-sm text-gray-500">{emptyMessage}</li>;
  }
  return (
    <>
      {deadlines.map((d, i) => (
        <PiCaseDeadlineRow key={`${d.label}-${d.date_iso ?? d.date}-${i}`} deadline={d} />
      ))}
    </>
  );
}

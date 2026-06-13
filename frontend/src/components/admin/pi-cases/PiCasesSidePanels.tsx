"use client";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  PiCaseDeadline,
  PiCaseTopAttorney,
  formatUsd,
} from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesSidePanelsProps = {
  deadlines: PiCaseDeadline[];
  attorneys: PiCaseTopAttorney[];
  loading?: boolean;
};

export default function PiCasesSidePanels({
  deadlines,
  attorneys,
  loading,
}: PiCasesSidePanelsProps) {
  const maxValue = Math.max(...attorneys.map((a) => a.total_value), 1);

  return (
    <div className="space-y-4">
      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Upcoming Deadlines</h3>
        <ul className="mt-3 space-y-3">
          {loading ? (
            <li className="text-sm text-gray-500">Loading…</li>
          ) : deadlines.length === 0 ? (
            <li className="text-sm text-gray-500">No upcoming deadlines.</li>
          ) : (
            deadlines.map((d, i) => {
              const parts = d.date.split(" ");
              return (
                <li key={`${d.label}-${i}`} className="flex gap-3">
                  <div
                    className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg text-center text-[10px] font-bold ${
                      d.is_overdue ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    <span>{parts[0]?.toUpperCase()}</span>
                    <span className="text-sm">{parts[1]}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{d.label}</p>
                    <p className="text-xs text-gray-500">{d.subtitle}</p>
                    <p
                      className={`text-xs font-medium ${
                        d.is_overdue ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {d.is_overdue ? "Overdue" : `${d.days_until} days`}
                    </p>
                  </div>
                </li>
              );
            })
          )}
        </ul>
        <button type="button" className="mt-3 text-xs font-medium text-emerald-700 hover:underline">
          View All →
        </button>
      </div>

      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Top Attorneys</h3>
        <div className="mt-3 space-y-3">
          {attorneys.length === 0 ? (
            <p className="text-sm text-gray-500">No attorney data.</p>
          ) : (
            attorneys.map((a) => (
              <div key={a.firm_name}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-gray-900">{a.firm_name}</span>
                  <span className="text-xs text-gray-500">{a.case_count} cases</span>
                </div>
                <p className="text-xs text-gray-500">{formatUsd(a.total_value)}</p>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                  <div
                    className="h-1.5 rounded-full bg-emerald-500"
                    style={{ width: `${(a.total_value / maxValue) * 100}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
        <button type="button" className="mt-3 text-xs font-medium text-emerald-700 hover:underline">
          View Report →
        </button>
      </div>
    </div>
  );
}

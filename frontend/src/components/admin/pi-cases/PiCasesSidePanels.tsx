"use client";

import { DS_CARD } from "@/app/admin/designSystem";
import { PiCaseDeadlineList } from "@/components/admin/pi-cases/PiCaseDeadlineList";
import {
  PiCaseDeadline,
  PiCaseTopAttorney,
  formatUsd,
} from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesSidePanelsProps = {
  deadlines: PiCaseDeadline[];
  attorneys: PiCaseTopAttorney[];
  loading?: boolean;
  onViewAllDeadlines?: () => void;
  onViewReport?: () => void;
};

export default function PiCasesSidePanels({
  deadlines,
  attorneys,
  loading,
  onViewAllDeadlines,
  onViewReport,
}: PiCasesSidePanelsProps) {
  const maxValue = Math.max(...attorneys.map((a) => a.total_value), 1);

  return (
    <div className="space-y-4">
      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Upcoming Deadlines</h3>
        <ul className="mt-3 space-y-3">
          <PiCaseDeadlineList deadlines={deadlines} loading={loading} />
        </ul>
        <button
          type="button"
          className="mt-3 text-xs font-medium text-emerald-700 hover:underline"
          onClick={onViewAllDeadlines}
        >
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
        <button
          type="button"
          className="mt-3 text-xs font-medium text-emerald-700 hover:underline"
          onClick={onViewReport}
        >
          View Report →
        </button>
      </div>
    </div>
  );
}

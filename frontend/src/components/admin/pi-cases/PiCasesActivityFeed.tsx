"use client";

import { AlertTriangle, Calendar, FileUp, Gavel, TrendingUp } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import { PiCaseActivity } from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesActivityFeedProps = {
  items: PiCaseActivity[];
  loading?: boolean;
  onViewAll?: () => void;
};

function ActivityIcon({ type }: { type: PiCaseActivity["type"] }) {
  const cls = "h-4 w-4 shrink-0";
  switch (type) {
    case "overdue":
      return <AlertTriangle className={`${cls} text-red-500`} />;
    case "upload":
      return <FileUp className={`${cls} text-amber-500`} />;
    case "settlement":
      return <TrendingUp className={`${cls} text-green-500`} />;
    case "hearing":
      return <Gavel className={`${cls} text-purple-500`} />;
    default:
      return <Calendar className={`${cls} text-gray-400`} />;
  }
}

export default function PiCasesActivityFeed({
  items,
  loading,
  onViewAll,
}: PiCasesActivityFeedProps) {
  return (
    <div className={DS_CARD}>
      <h3 className="text-sm font-semibold text-gray-900">Case Activity</h3>
      <ul className="mt-4 divide-y divide-gray-100">
        {loading ? (
          <li className="py-6 text-center text-sm text-gray-500">Loading…</li>
        ) : items.length === 0 ? (
          <li className="py-6 text-center text-sm text-gray-500">No recent activity.</li>
        ) : (
          items.slice(0, 8).map((item, i) => (
            <li key={`${item.description}-${i}`} className="flex gap-3 py-3">
              <ActivityIcon type={item.type} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">{item.description}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                    {item.tag}
                  </span>
                  <span className="text-xs text-gray-400">{item.timestamp}</span>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        className="mt-2 text-xs font-medium text-emerald-700 hover:underline"
        onClick={onViewAll}
      >
        View All →
      </button>
    </div>
  );
}

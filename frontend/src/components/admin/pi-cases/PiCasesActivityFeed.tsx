"use client";

import { DS_CARD } from "@/app/admin/designSystem";
import { PiCaseActivityList } from "@/components/admin/pi-cases/PiCaseActivityList";
import { PiCaseActivity } from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesActivityFeedProps = {
  items: PiCaseActivity[];
  loading?: boolean;
  onViewAll?: () => void;
};

export default function PiCasesActivityFeed({
  items,
  loading,
  onViewAll,
}: PiCasesActivityFeedProps) {
  return (
    <div className={DS_CARD}>
      <h3 className="text-sm font-semibold text-gray-900">Case Activity</h3>
      <ul className="mt-4 divide-y divide-gray-100">
        <PiCaseActivityList items={items} loading={loading} maxItems={8} />
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

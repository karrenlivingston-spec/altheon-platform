"use client";

import { AlertTriangle, Calendar, FileUp, Gavel, TrendingUp } from "lucide-react";

import { PiCaseActivity } from "@/components/admin/pi-cases/piCasesTypes";

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

export function PiCaseActivityRow({ item }: { item: PiCaseActivity }) {
  return (
    <li className="flex gap-3 py-3">
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
  );
}

type PiCaseActivityListProps = {
  items: PiCaseActivity[];
  loading?: boolean;
  emptyMessage?: string;
  maxItems?: number;
};

export function PiCaseActivityList({
  items,
  loading,
  emptyMessage = "No recent activity.",
  maxItems,
}: PiCaseActivityListProps) {
  if (loading) {
    return <li className="py-6 text-center text-sm text-gray-500">Loading…</li>;
  }
  const visible = maxItems != null ? items.slice(0, maxItems) : items;
  if (visible.length === 0) {
    return <li className="py-6 text-center text-sm text-gray-500">{emptyMessage}</li>;
  }
  return (
    <>
      {visible.map((item, i) => (
        <PiCaseActivityRow key={`${item.description}-${item.timestamp}-${i}`} item={item} />
      ))}
    </>
  );
}

"use client";

import Link from "next/link";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  ActivityItem,
  relativeTime,
} from "@/components/admin/dashboard/dashboardTypes";

const TYPE_STYLES: Record<
  string,
  { icon: string; border: string }
> = {
  note: { icon: "📝", border: "border-l-teal-500" },
  appointment: { icon: "📅", border: "border-l-blue-500" },
  legal: { icon: "⚖️", border: "border-l-indigo-500" },
  payment: { icon: "💰", border: "border-l-green-500" },
  intake: { icon: "👤", border: "border-l-amber-500" },
  claim: { icon: "📄", border: "border-l-purple-500" },
};

type RecentActivityProps = {
  items: ActivityItem[];
};

export default function RecentActivity({ items }: RecentActivityProps) {
  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Recent Activity</h2>
        <Link
          href="/admin/billing"
          className="text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          View All Activity →
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No recent activity</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 6).map((item, i) => {
            const style = TYPE_STYLES[item.type] ?? {
              icon: "•",
              border: "border-l-gray-300",
            };
            return (
              <li key={`${item.timestamp}-${i}`}>
                <Link
                  href={item.link_to}
                  className={`flex items-start gap-3 rounded-lg border border-gray-100 border-l-4 ${style.border} bg-gray-50/50 px-3 py-2.5 text-sm hover:bg-gray-50`}
                >
                  <span className="text-base" aria-hidden>
                    {style.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-gray-900">{item.description}</span>
                    <span className="text-xs text-gray-500">
                      {relativeTime(item.timestamp)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

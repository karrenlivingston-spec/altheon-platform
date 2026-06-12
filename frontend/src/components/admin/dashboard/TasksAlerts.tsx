"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import { DashboardSummary } from "@/components/admin/dashboard/dashboardTypes";

type TasksAlertsProps = {
  data: DashboardSummary;
};

type TaskRow = {
  icon: string;
  label: string;
  count: number;
  href: string;
  badgeClass: string;
};

export default function TasksAlerts({ data }: TasksAlertsProps) {
  const claimsNeed =
    data.claims_requiring_action.denied.count +
    data.claims_requiring_action.pending.count;

  const rows: TaskRow[] = [
    {
      icon: "👤",
      label: "patient intakes incomplete",
      count: data.tasks.incomplete_intakes,
      href: "/admin/patients",
      badgeClass: "bg-amber-100 text-amber-800",
    },
    {
      icon: "📄",
      label: "claims need attention",
      count: claimsNeed,
      href: "/admin/billing",
      badgeClass: "bg-red-100 text-red-700",
    },
    {
      icon: "📝",
      label: "notes need review & signature",
      count: data.tasks.notes_review,
      href: "/admin/clinical-notes",
      badgeClass: "bg-amber-100 text-amber-800",
    },
    {
      icon: "⚖️",
      label: "legal requests in progress",
      count: data.tasks.legal_in_progress,
      href: "/admin/legal-requests",
      badgeClass: "bg-blue-100 text-blue-800",
    },
    {
      icon: "📅",
      label: "appointments need confirmation",
      count: data.tasks.unconfirmed_appointments,
      href: "/admin/appointments",
      badgeClass: "bg-gray-100 text-gray-700",
    },
  ];

  const total = rows.reduce((a, r) => a + r.count, 0);

  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Tasks & Alerts</h2>
        <Link
          href="/admin/clinical-notes"
          className="text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          View All →
        </Link>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500" aria-hidden />
          <p className="text-sm font-medium text-green-700">
            All caught up! No tasks pending.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) =>
            row.count > 0 ? (
              <li key={row.label}>
                <Link
                  href={row.href}
                  className="flex items-center gap-3 py-3 text-sm hover:bg-gray-50"
                >
                  <span className="text-lg" aria-hidden>
                    {row.icon}
                  </span>
                  <span className="flex-1 text-gray-700">
                    <span className="font-semibold text-gray-900">{row.count}</span>{" "}
                    {row.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.badgeClass}`}
                  >
                    {row.count}
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />
                </Link>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </div>
  );
}

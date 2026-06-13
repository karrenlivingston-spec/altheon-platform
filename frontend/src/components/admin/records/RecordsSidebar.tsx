"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  AttorneyRequest,
  TypeBreakdown,
} from "@/components/admin/records/recordsTypes";

type RecordsSidebarProps = {
  attorneyRequests: AttorneyRequest[];
  typeBreakdown: TypeBreakdown | null;
  loading?: boolean;
};

function dueBadge(req: AttorneyRequest): { text: string; className: string } {
  if (req.is_overdue) {
    return { text: "Overdue", className: "bg-red-50 text-red-700" };
  }
  if (req.days_until_due <= 3) {
    return {
      text: `Due in ${req.days_until_due} days`,
      className: "bg-amber-50 text-amber-700",
    };
  }
  return {
    text: `Due in ${req.days_until_due} days`,
    className: "bg-blue-50 text-blue-700",
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

export default function RecordsSidebar({
  attorneyRequests,
  typeBreakdown,
  loading,
}: RecordsSidebarProps) {
  const data =
    typeBreakdown?.breakdown.filter((b) => b.count > 0) ?? [];
  const total = typeBreakdown?.total ?? 0;

  return (
    <div className="space-y-4 xl:sticky xl:top-4">
      <div className={DS_CARD}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Attorney Requests</h3>
          <Link
            href="/admin/legal-requests"
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            View All →
          </Link>
        </div>
        {loading ? (
          <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
        ) : attorneyRequests.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500">No pending requests</p>
        ) : (
          <ul className="space-y-3">
            {attorneyRequests.map((req) => {
              const badge = dueBadge(req);
              return (
                <li key={req.id}>
                  <Link
                    href="/admin/legal-requests"
                    className="flex items-start gap-3 rounded-lg p-2 hover:bg-gray-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-semibold text-purple-700">
                      {initials(req.patient_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {req.patient_name}
                      </p>
                      <p className="truncate text-xs text-gray-500">{req.firm_name}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        Requested {req.requested_date}
                      </p>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.text}
                      </span>
                    </div>
                    <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-gray-300" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/admin/legal-requests"
          className="mt-3 block text-center text-xs font-medium text-emerald-700 hover:underline"
        >
          View All Requests →
        </Link>
      </div>

      <div className={DS_CARD}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Record Types Overview</h3>
          <button type="button" className="text-xs font-medium text-emerald-700 hover:underline">
            View Full Report →
          </button>
        </div>
        <p className="text-xs text-gray-500">This month</p>
        {loading ? (
          <p className="mt-8 py-12 text-center text-sm text-gray-500">Loading chart…</p>
        ) : (
          <>
            <div className="relative mx-auto mt-4 h-44 w-full max-w-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      data.length
                        ? data.map((d) => ({
                            name: d.label,
                            value: d.count,
                            color: d.color,
                          }))
                        : [{ name: "None", value: 1, color: "#e5e7eb" }]
                    }
                    dataKey="value"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={2}
                  >
                    {(data.length
                      ? data
                      : [{ color: "#e5e7eb", label: "", count: 1 }]
                    ).map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-2xl font-bold text-gray-900">{total}</p>
                <p className="text-xs text-gray-500">Total</p>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5">
              {(typeBreakdown?.breakdown ?? []).map((b) => (
                <li
                  key={b.label}
                  className="flex items-center justify-between text-xs text-gray-600"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: b.color }}
                    />
                    {b.label}
                  </span>
                  <span>
                    {b.count} ({b.pct}%)
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

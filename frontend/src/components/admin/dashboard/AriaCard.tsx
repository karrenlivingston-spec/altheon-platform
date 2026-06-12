"use client";

import Link from "next/link";
import { AudioLines } from "lucide-react";

import { DS_CARD, DS_PRIMARY_BTN } from "@/app/admin/designSystem";
import {
  DashboardSummary,
  formatDuration,
} from "@/components/admin/dashboard/dashboardTypes";

type AriaCardProps = {
  data: DashboardSummary;
  agentName?: string;
};

export default function AriaCard({ data, agentName = "Aria" }: AriaCardProps) {
  const aria = data.aria;

  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Aria Voice Agent</h2>
        <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
          {aria.is_online ? "Online" : "Offline"}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-900">
          <AudioLines className="h-7 w-7 text-green-400" aria-hidden />
        </div>
        <div>
          <p className="font-semibold text-gray-900">{agentName}</p>
          <p className="text-sm text-gray-500">Your AI Receptionist</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-gray-50 px-2 py-3">
          <p className="text-lg font-bold text-gray-900">{aria.calls_today}</p>
          <p className="text-xs text-gray-500">Calls Today</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-3">
          <p className="text-lg font-bold text-green-600">{aria.booked_today}</p>
          <p className="text-xs text-gray-500">Booked</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-3">
          <p className="text-lg font-bold text-red-600">{aria.missed_today}</p>
          <p className="text-xs text-gray-500">Missed</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-3">
          <p className="text-sm font-bold text-gray-900">
            {formatDuration(aria.avg_duration_seconds)}
          </p>
          <p className="text-xs text-gray-500">Avg Duration</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-3">
          <p className="text-lg font-bold text-gray-900">{aria.success_rate}%</p>
          <p className="text-xs text-gray-500">Success</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-3">
          <p className="text-sm font-bold text-teal-600">24/7</p>
          <p className="text-xs text-gray-500">Always On</p>
        </div>
      </div>

      <Link href="/admin/voice-agent" className={`${DS_PRIMARY_BTN} mt-5 block text-center`}>
        Go to Voice Agent →
      </Link>
    </div>
  );
}

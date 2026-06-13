"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AudioLines,
  LayoutGrid,
  MapPin,
  MoreHorizontal,
  Settings,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

import { DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import {
  ClinicCardData,
  VITALITY_CLINIC_ID,
  collectionBarColor,
  formatUsd,
  noShowBarColor,
} from "@/components/admin/clinics/clinicsTypes";

type ClinicCardProps = {
  clinic: ClinicCardData;
  onEdit: (clinic: ClinicCardData) => void;
  onDeactivate: (clinic: ClinicCardData) => void;
  onReactivate: (clinic: ClinicCardData) => void;
  onViewDashboard: (clinic: ClinicCardData) => void;
};

export default function ClinicCard({
  clinic,
  onEdit,
  onDeactivate,
  onReactivate,
  onViewDashboard,
}: ClinicCardProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isActive = clinic.status !== "inactive";
  const isVitality = clinic.id === VITALITY_CLINIC_ID;
  const agentOnline = clinic.agent_status === "online";

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const maxTrend = Math.max(...clinic.collections_trend.map((d) => d.amount), 1);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              isActive
                ? "animate-pulse bg-green-500"
                : "bg-gray-400"
            }`}
            aria-hidden
          />
          <span className="text-xs font-medium text-gray-600">
            {isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Clinic actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setMenuOpen(false);
                  onEdit(clinic);
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setMenuOpen(false);
                  onViewDashboard(clinic);
                }}
              >
                View Dashboard
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setMenuOpen(false);
                  router.push("/admin/settings");
                }}
              >
                Settings
              </button>
              {!isVitality ? (
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setMenuOpen(false);
                    if (isActive) onDeactivate(clinic);
                    else onReactivate(clinic);
                  }}
                >
                  {isActive ? "Deactivate" : "Reactivate"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="text-lg font-bold text-gray-900">{clinic.name}</h3>
        <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {clinic.address}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900">
            <AudioLines className="h-4 w-4 text-green-400" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{clinic.agent_name}</p>
            <p className="text-xs text-gray-500">Voice Agent</p>
          </div>
        </div>
        <div className="text-right">
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              agentOnline ? "text-green-600" : "text-gray-500"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                agentOnline ? "animate-pulse bg-green-500" : "bg-gray-400"
              }`}
            />
            {agentOnline ? "Online" : "Offline"}
          </span>
          <p className="mt-0.5 text-sm font-semibold text-gray-900">
            {clinic.agent_success_rate_pct}%
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-gray-900">{clinic.patient_count}</p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Patients</p>
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900">{clinic.appointments_mtd}</p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">Appts (MTD)</p>
        </div>
        <div>
          <p className="text-lg font-bold text-gray-900">
            {formatUsd(clinic.collected_mtd)}
          </p>
          <p className="text-[10px] uppercase tracking-wide text-gray-500">
            Collected (MTD)
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">Collection Rate</span>
            <span className="font-semibold text-gray-900">
              {clinic.collection_rate_pct}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${collectionBarColor(clinic.collection_rate_pct)}`}
              style={{ width: `${Math.min(clinic.collection_rate_pct, 100)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600">No Show Rate</span>
            <span className="font-semibold text-gray-900">
              {clinic.no_show_rate_pct}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${noShowBarColor(clinic.no_show_rate_pct)}`}
              style={{ width: `${Math.min(clinic.no_show_rate_pct * 5, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
          Collections Trend (MTD)
        </p>
        <div className="h-12 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={clinic.collections_trend}>
              <YAxis domain={[0, maxTrend]} hide />
              <Line
                type="monotone"
                dataKey="amount"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 flex gap-2 border-t border-gray-100 pt-4">
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#16a34a] px-3 py-2 text-sm font-medium text-[#16a34a] hover:bg-green-50"
          onClick={() => onViewDashboard(clinic)}
        >
          <LayoutGrid className="h-4 w-4" />
          View Dashboard
        </button>
        {isActive ? (
          <Link
            href="/admin/settings"
            className={`${DS_SECONDARY_BTN} flex flex-1 items-center justify-center gap-1.5`}
            onClick={() => onViewDashboard(clinic)}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        ) : (
          <button
            type="button"
            className={`${DS_SECONDARY_BTN} flex-1`}
            onClick={() => onReactivate(clinic)}
          >
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}

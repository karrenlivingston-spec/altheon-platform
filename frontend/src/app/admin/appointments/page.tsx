"use client";

import { useEffect, useMemo, useState } from "react";

import {
  addDaysToYmd,
  formatTimeEastern,
  getEasternYMD,
  getThisWeekRangeEasternYmd,
  isYmdInInclusiveRange,
} from "@/components/adminEastern";
import PatientFlow from "@/components/scheduling/PatientFlow";
import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECTION_HEADER,
} from "@/app/admin/designSystem";

const API_BASE = "https://altheon-platform.onrender.com";

type AppointmentRow = {
  id: string;
  start_time: string;
  status: string;
  patients?: { first_name?: string; last_name?: string } | null;
  clinicians?: { first_name?: string; last_name?: string } | null;
  treatment_types?: { name?: string } | null;
};

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "numeric",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 15, 0, 0)));
}

function patientName(row: AppointmentRow): string {
  return `${row.patients?.first_name ?? ""} ${row.patients?.last_name ?? ""}`.trim() || "—";
}

function clinicianName(row: AppointmentRow): string {
  const last = (row.clinicians?.last_name ?? "").trim();
  const first = (row.clinicians?.first_name ?? "").trim();
  if (last) return `Dr. ${last}`;
  if (first) return `Dr. ${first}`;
  return "Clinician";
}

function statusDotClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "checked_in") return "bg-[#16A34A]";
  if (s === "completed") return "bg-[#7C3AED]";
  if (s === "cancelled") return "bg-[#DC2626]";
  return "bg-slate-400";
}

function tabClass(active: boolean): string {
  return active
    ? "rounded-lg bg-[#0B1A2B] px-4 py-2 text-sm font-medium text-white"
    : "rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100";
}

export default function AdminAppointmentsPage() {
  const { clinicId } = useClinic();
  const [activeTab, setActiveTab] = useState<"calendar" | "patient_flow">("calendar");
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/appointments?clinic_id=${encodeURIComponent(clinicId)}`,
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) {
          setAppointments(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) setAppointments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const todayYmd = useMemo(() => getEasternYMD(new Date()), []);
  const { mon: weekMon, sun: weekSun } = useMemo(
    () => getThisWeekRangeEasternYmd(new Date()),
    [],
  );
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDaysToYmd(weekMon, idx)),
    [weekMon],
  );
  const weekAppointments = useMemo(
    () =>
      appointments.filter((a) =>
        isYmdInInclusiveRange(getEasternYMD(new Date(a.start_time)), weekMon, weekSun),
      ),
    [appointments, weekMon, weekSun],
  );

  return (
    <div className={`${DS_PAGE_ROOT} mx-auto max-w-7xl`}>
      <h1 className={`${DS_PAGE_TITLE} mb-6 font-bold`}>Scheduling</h1>
      <p className={DS_PAGE_SUBTITLE}>Calendar and patient flow</p>

      <div className="mt-6 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <button
          type="button"
          className={tabClass(activeTab === "calendar")}
          onClick={() => setActiveTab("calendar")}
        >
          Calendar
        </button>
        <button
          type="button"
          className={tabClass(activeTab === "patient_flow")}
          onClick={() => setActiveTab("patient_flow")}
        >
          Patient Flow
        </button>
      </div>

      {activeTab === "patient_flow" ? (
        <section className="mt-6">
          <PatientFlow />
        </section>
      ) : (
        <section className="mt-8">
          <h2 className={DS_SECTION_HEADER}>Week Calendar</h2>
          {loading ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
              Loading…
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-7">
              {weekDays.map((ymd) => {
                const rows = weekAppointments
                  .filter((a) => getEasternYMD(new Date(a.start_time)) === ymd)
                  .sort(
                    (a, b) =>
                      new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
                  );
                const isToday = ymd === todayYmd;
                return (
                  <div
                    key={ymd}
                    className={[`${DS_CARD} p-4`, isToday ? "ring-2 ring-green-500/25" : ""]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <p className="mb-3 text-sm font-semibold text-slate-900">{dayLabel(ymd)}</p>
                    <div className="space-y-2">
                      {rows.length === 0 ? (
                        <p className="text-xs text-slate-400">No appointments</p>
                      ) : (
                        rows.map((row) => (
                          <div key={row.id} className="rounded-lg border border-black/10 bg-slate-50 p-2">
                            <p className="text-xs text-slate-500">{formatTimeEastern(row.start_time)}</p>
                            <p className="truncate text-xs font-medium text-slate-800">
                              {patientName(row)}
                            </p>
                            <p className="truncate text-[11px] text-slate-500">
                              {clinicianName(row)}
                            </p>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${statusDotClass(row.status)}`} />
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}


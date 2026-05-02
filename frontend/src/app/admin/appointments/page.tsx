"use client";

import { useEffect, useMemo, useState } from "react";

import {
  addDaysToYmd,
  formatTimeEastern,
  getEasternYMD,
  getThisWeekRangeEasternYmd,
  isYmdInInclusiveRange,
} from "@/components/adminEastern";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";

const CLINICIAN_WEST_ID = "fb6fa0fc-78f3-48c0-818b-511ad7a8ee93";
const CLINICIAN_SHARPE_ID = "ee6eaa90-1f90-4af7-85a5-4ae78aea3df7";

type ClinicianFilter = "all" | "west" | "sharpe";

type AppointmentRow = {
  id: string;
  clinician_id: string;
  start_time: string;
  status: string;
  patients?: { first_name?: string; last_name?: string } | null;
  treatment_types?: { name?: string } | null;
};

function clinicianLabel(id: string): string {
  if (id === CLINICIAN_WEST_ID) return "Dr. West";
  if (id === CLINICIAN_SHARPE_ID) return "Dr. Sharpe";
  return id;
}

function patientName(row: AppointmentRow): string {
  const p = row.patients;
  const full = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
  return full || "—";
}

function serviceName(row: AppointmentRow): string {
  return row.treatment_types?.name ?? "—";
}

function flowCardClinicianBorderClass(clinicianId: string): string {
  if (clinicianId === CLINICIAN_WEST_ID) {
    return "border-l-4 border-l-[#1A6B8A]";
  }
  if (clinicianId === CLINICIAN_SHARPE_ID) {
    return "border-l-4 border-l-[#7C3AED]";
  }
  return "border-l-4 border-l-gray-300";
}

function filterPillClass(isActive: boolean): string {
  const base =
    "cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150";
  if (isActive) {
    return `${base} bg-green-600 text-white`;
  }
  return `${base} bg-gray-100 text-gray-600 hover:bg-gray-200`;
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "numeric",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 15, 0, 0)));
}

export default function AdminAppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});
  const [clinicianFilter, setClinicianFilter] = useState<ClinicianFilter>("all");

  async function refreshAppointments() {
    try {
      const res = await fetch(
        `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
      );
      const data = res.ok ? await res.json() : [];
      setAppointments(Array.isArray(data) ? data : []);
    } catch {
      setAppointments([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const res = await fetch(
          `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) {
          setAppointments(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setAppointments([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchData();

    const interval = setInterval(() => {
      void fetchData();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const filteredAppointments = useMemo(() => {
    if (clinicianFilter === "west") {
      return appointments.filter((a) => a.clinician_id === CLINICIAN_WEST_ID);
    }
    if (clinicianFilter === "sharpe") {
      return appointments.filter((a) => a.clinician_id === CLINICIAN_SHARPE_ID);
    }
    return appointments;
  }, [appointments, clinicianFilter]);

  const todayYmd = useMemo(() => getEasternYMD(new Date()), []);
  const { mon: weekMon, sun: weekSun } = useMemo(
    () => getThisWeekRangeEasternYmd(new Date()),
    [],
  );

  const todayAppointments = useMemo(
    () =>
      filteredAppointments
        .filter((a) => getEasternYMD(new Date(a.start_time)) === todayYmd)
        .sort(
          (a, b) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
        ),
    [filteredAppointments, todayYmd],
  );

  const scheduled = todayAppointments.filter((a) => {
    const s = a.status.toLowerCase();
    return s === "scheduled" || s === "cancelled";
  });
  const checkedIn = todayAppointments.filter((a) => a.status === "checked_in");
  const completed = todayAppointments.filter((a) => a.status === "completed");

  const weekAppointments = useMemo(
    () =>
      filteredAppointments.filter((a) =>
        isYmdInInclusiveRange(
          getEasternYMD(new Date(a.start_time)),
          weekMon,
          weekSun,
        ),
      ),
    [filteredAppointments, weekMon, weekSun],
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDaysToYmd(weekMon, idx)),
    [weekMon],
  );

  async function patchStatus(appointmentId: string, status: string) {
    setUpdatingIds((prev) => ({ ...prev, [appointmentId]: true }));
    try {
      const res = await fetch(
        `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/status?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        return;
      }
      setAppointments((prev) =>
        prev.map((a) => (a.id === appointmentId ? { ...a, status } : a)),
      );
      await refreshAppointments();
    } finally {
      setUpdatingIds((prev) => {
        const next = { ...prev };
        delete next[appointmentId];
        return next;
      });
    }
  }

  function renderCard(row: AppointmentRow, column: "scheduled" | "checked_in" | "completed") {
    const busy = !!updatingIds[row.id];
    const canCancel = column !== "completed";
    const isCancelledScheduled =
      column === "scheduled" && row.status.toLowerCase() === "cancelled";

    const accent = flowCardClinicianBorderClass(row.clinician_id);
    const cardShell = [
      "rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all duration-150 hover:shadow-md",
      accent,
    ].join(" ");

    if (isCancelledScheduled) {
      return (
        <div key={row.id} className={cardShell}>
          <div className="space-y-1">
            <p className="text-base font-semibold text-gray-500 line-through">
              {patientName(row)}
            </p>
            <p className="text-sm font-medium text-gray-700">
              {formatTimeEastern(row.start_time)}
            </p>
            <p className="text-xs text-gray-500">
              {clinicianLabel(row.clinician_id)}
            </p>
            <p className="text-xs text-gray-500">{serviceName(row)}</p>
          </div>
          <p className="mt-3 text-xs font-medium text-gray-500">Cancelled</p>
        </div>
      );
    }

    return (
      <div key={row.id} className={cardShell}>
        <div className="space-y-1">
          <p className="text-base font-semibold text-gray-900">
            {patientName(row)}
          </p>
          <p className="text-sm font-medium text-gray-700">
            {formatTimeEastern(row.start_time)}
          </p>
          <p className="text-xs text-gray-500">
            {clinicianLabel(row.clinician_id)}
          </p>
          <p className="text-xs text-gray-500">{serviceName(row)}</p>
        </div>
        {column === "completed" ? (
          <p className="mt-3 text-xs font-medium text-emerald-700">✓ Completed</p>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            {column === "scheduled" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "checked_in")}
                className="rounded-lg bg-[#1a6b3c] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Check In
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "completed")}
                className="rounded-lg bg-[#1a6b3c] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Complete
              </button>
            )}
            {canCancel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "cancelled")}
                className="text-sm text-gray-400 transition hover:text-red-500 disabled:opacity-50"
              >
                Cancel
              </button>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Appointments</h1>
      <p className="mb-8 text-sm tracking-wide text-gray-500">
        Today&apos;s flow and week view
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={filterPillClass(clinicianFilter === "all")}
          onClick={() => setClinicianFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={filterPillClass(clinicianFilter === "west")}
          onClick={() => setClinicianFilter("west")}
        >
          Dr. West
        </button>
        <button
          type="button"
          className={filterPillClass(clinicianFilter === "sharpe")}
          onClick={() => setClinicianFilter("sharpe")}
        >
          Dr. Sharpe
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-gray-500">
          Patient Flow Board
        </h2>
        <div className="mt-4 rounded-2xl bg-white p-6 shadow-sm">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <FlowColumn
                label="Scheduled"
                count={scheduled.length}
                emptyMessage="No appointments scheduled"
                items={scheduled.map((row) => renderCard(row, "scheduled"))}
              />
              <FlowColumn
                label="Checked In"
                count={checkedIn.length}
                emptyMessage="No patients checked in yet"
                items={checkedIn.map((row) => renderCard(row, "checked_in"))}
              />
              <FlowColumn
                label="Completed"
                count={completed.length}
                emptyMessage="No completed appointments yet"
                items={completed.map((row) => renderCard(row, "completed"))}
              />
            </div>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Week Calendar
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-7">
          {weekDays.map((ymd) => {
            const dayRows = weekAppointments
              .filter((a) => getEasternYMD(new Date(a.start_time)) === ymd)
              .sort(
                (a, b) =>
                  new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
              );
            const isToday = ymd === todayYmd;

            return (
              <div
                key={ymd}
                className={[
                  "rounded-2xl border border-gray-100 p-5 shadow-sm",
                  isToday ? "bg-emerald-50/40" : "bg-white",
                ].join(" ")}
              >
                <p className="mb-3 text-sm font-semibold text-gray-900">{dayLabel(ymd)}</p>
                <div className="space-y-2">
                  {dayRows.length === 0 ? (
                    <p className="text-xs text-gray-400">
                      No appointments scheduled
                    </p>
                  ) : (
                    dayRows.map((row) => {
                      const west = row.clinician_id === CLINICIAN_WEST_ID;
                      const sharpe = row.clinician_id === CLINICIAN_SHARPE_ID;
                      const st = row.status.toLowerCase();
                      const cancelled = st === "cancelled";
                      const checkedInBlock = st === "checked_in";
                      const completedBlock = st === "completed";
                      const fullName = patientName(row);
                      const cellAccent = west
                        ? "border-l-2 border-l-[#1A6B8A] bg-blue-50"
                        : sharpe
                          ? "border-l-2 border-l-[#7C3AED] bg-purple-50"
                          : "border-l-2 border-l-gray-300 bg-gray-50";

                      return (
                        <div
                          key={row.id}
                          title={fullName}
                          className={[
                            "overflow-visible rounded-lg py-1.5 px-2 text-xs",
                            cellAccent,
                            cancelled ? "opacity-50" : "",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-gray-500">
                                {formatTimeEastern(row.start_time)}
                              </p>
                              <p
                                className={`mt-0.5 break-words text-xs font-semibold text-gray-800 ${cancelled ? "line-through" : ""}`}
                              >
                                {fullName}
                              </p>
                            </div>
                            {checkedInBlock ? (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium leading-tight text-amber-800">
                                Checked In
                              </span>
                            ) : completedBlock ? (
                              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium leading-tight text-emerald-800">
                                ✓ Done
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function FlowColumn({
  label,
  count,
  items,
  emptyMessage,
}: {
  label: string;
  count: number;
  items: React.ReactNode[];
  emptyMessage: string;
}) {
  const countLine =
    count === 1 ? "1 patient" : `${count} patients`;

  return (
    <div className="flex min-h-[400px] flex-col rounded-xl bg-gray-50 p-5">
      <div className="mb-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-sm text-gray-600">{countLine}</p>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="mb-3 h-8 w-8 rounded-full bg-gray-200" />
          <p className="text-sm text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-4">{items}</div>
      )}
    </div>
  );
}

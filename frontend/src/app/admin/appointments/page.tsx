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

    if (isCancelledScheduled) {
      return (
        <div key={row.id} className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
          <p className="text-sm font-semibold text-neutral-500 line-through">
            {patientName(row)}
          </p>
          <p className="mt-1 text-xs text-neutral-600">
            {formatTimeEastern(row.start_time)} • {clinicianLabel(row.clinician_id)}
          </p>
          <p className="mt-1 text-xs text-neutral-600">{serviceName(row)}</p>
          <p className="mt-2 text-xs font-medium text-neutral-500">Cancelled</p>
        </div>
      );
    }

    return (
      <div key={row.id} className="rounded-md border border-gray-200 bg-white p-3 shadow-sm">
        <p className="text-sm font-semibold text-neutral-900">{patientName(row)}</p>
        <p className="mt-1 text-xs text-neutral-600">
          {formatTimeEastern(row.start_time)} • {clinicianLabel(row.clinician_id)}
        </p>
        <p className="mt-1 text-xs text-neutral-600">{serviceName(row)}</p>
        {column === "completed" ? (
          <p className="mt-2 text-xs font-medium text-green-700">✓ Completed</p>
        ) : (
          <div className="mt-3 flex gap-2">
            {column === "scheduled" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "checked_in")}
                className="rounded border border-[#2D5E3F]/30 bg-[#2D5E3F]/10 px-2 py-1 text-xs font-medium text-[#2D5E3F] disabled:opacity-60"
              >
                Check In
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "completed")}
                className="rounded border border-[#2D5E3F]/30 bg-[#2D5E3F]/10 px-2 py-1 text-xs font-medium text-[#2D5E3F] disabled:opacity-60"
              >
                Complete
              </button>
            )}
            {canCancel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "cancelled")}
                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 disabled:opacity-60"
              >
                Cancel
              </button>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const pill =
    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors border border-transparent";
  const pillActive = "bg-[#2D5E3F] text-white border-[#2D5E3F]";
  const pillIdle =
    "bg-white text-neutral-700 border-neutral-200 hover:border-[#2D5E3F]/40";

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-6 text-3xl font-bold text-neutral-900">Appointments</h1>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          className={`${pill} ${clinicianFilter === "all" ? pillActive : pillIdle}`}
          onClick={() => setClinicianFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={`${pill} ${clinicianFilter === "west" ? pillActive : pillIdle}`}
          onClick={() => setClinicianFilter("west")}
        >
          Dr. West
        </button>
        <button
          type="button"
          className={`${pill} ${clinicianFilter === "sharpe" ? pillActive : pillIdle}`}
          onClick={() => setClinicianFilter("sharpe")}
        >
          Dr. Sharpe
        </button>
      </div>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-700">Patient Flow Board</h2>
        {loading ? (
          <p className="text-sm text-neutral-600">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <FlowColumn
              title={`Scheduled (${scheduled.length})`}
              bg="#F0F4F8"
              emptyMessage="No appointments scheduled"
              items={scheduled.map((row) => renderCard(row, "scheduled"))}
            />
            <FlowColumn
              title={`Checked In (${checkedIn.length})`}
              bg="#FFF8E7"
              emptyMessage="No patients checked in yet"
              items={checkedIn.map((row) => renderCard(row, "checked_in"))}
            />
            <FlowColumn
              title={`Completed (${completed.length})`}
              bg="#F0FFF4"
              emptyMessage="No completed appointments yet"
              items={completed.map((row) => renderCard(row, "completed"))}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-700">Week Calendar</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
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
                className="rounded-lg border border-neutral-200 p-3"
                style={{ backgroundColor: isToday ? "#F5FFF8" : "white" }}
              >
                <p className="mb-3 text-sm font-semibold text-neutral-800">{dayLabel(ymd)}</p>
                <div className="space-y-2">
                  {dayRows.length === 0 ? (
                    <p className="text-xs text-neutral-400">
                      No appointments scheduled
                    </p>
                  ) : (
                    dayRows.map((row) => {
                      const west = clinicianLabel(row.clinician_id) === "Dr. West";
                      const st = row.status.toLowerCase();
                      const cancelled = st === "cancelled";
                      const checkedInBlock = st === "checked_in";
                      const completedBlock = st === "completed";

                      return (
                        <div
                          key={row.id}
                          className="rounded px-2 py-1.5 text-xs text-white"
                          style={{
                            backgroundColor: west ? "#1A6B8A" : "#7C3AED",
                            opacity: cancelled ? 0.5 : 1,
                          }}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium">
                                {formatTimeEastern(row.start_time)}
                              </p>
                              <p className={`truncate ${cancelled ? "line-through" : ""}`}>
                                {patientName(row)}
                              </p>
                            </div>
                            {checkedInBlock ? (
                              <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-neutral-800">
                                Checked In
                              </span>
                            ) : completedBlock ? (
                              <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold leading-tight text-neutral-800">
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
  title,
  bg,
  items,
  emptyMessage,
}: {
  title: string;
  bg: string;
  items: React.ReactNode[];
  emptyMessage: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4" style={{ backgroundColor: bg }}>
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
        {title}
      </p>
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-xs text-neutral-500">{emptyMessage}</p>
        ) : (
          items
        )}
      </div>
    </div>
  );
}

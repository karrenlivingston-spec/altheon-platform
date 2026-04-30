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

type AppointmentRow = {
  id: string;
  clinician_id: string;
  start_time: string;
  status: string;
  patients?: { first_name?: string; last_name?: string } | null;
  treatment_types?: { name?: string } | null;
};

function clinicianLabel(id: string): string {
  if (id === "fb6fa0fc-78f3-48c0-818b-511ad7a8ee93") return "Dr. West";
  if (id === "ee6eaa90-1f90-4af7-85a5-4ae78aea3df7") return "Dr. Sharpe";
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
    (async () => {
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
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const todayYmd = useMemo(() => getEasternYMD(new Date()), []);
  const { mon: weekMon, sun: weekSun } = useMemo(
    () => getThisWeekRangeEasternYmd(new Date()),
    [],
  );

  const todayAppointments = useMemo(
    () =>
      appointments
        .filter((a) => getEasternYMD(new Date(a.start_time)) === todayYmd)
        .sort(
          (a, b) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
        ),
    [appointments, todayYmd],
  );

  const scheduled = todayAppointments.filter((a) => a.status === "scheduled");
  const checkedIn = todayAppointments.filter((a) => a.status === "checked_in");
  const completed = todayAppointments.filter((a) => a.status === "completed");

  const weekAppointments = useMemo(
    () =>
      appointments.filter((a) =>
        isYmdInInclusiveRange(
          getEasternYMD(new Date(a.start_time)),
          weekMon,
          weekSun,
        ),
      ),
    [appointments, weekMon, weekSun],
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDaysToYmd(weekMon, idx)),
    [weekMon],
  );

  async function patchStatus(appointmentId: string, status: string) {
    setUpdatingIds((prev) => ({ ...prev, [appointmentId]: true }));
    try {
      await fetch(
        `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/status?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
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
    return (
      <div key={row.id} className="rounded-md border border-neutral-200 bg-white p-3 shadow-sm">
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

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900">Appointments</h1>

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Patient Flow Board</h2>
        {loading ? (
          <p className="text-sm text-neutral-600">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <FlowColumn
              title={`Scheduled (${scheduled.length})`}
              bg="#F0F4F8"
              items={scheduled.map((row) => renderCard(row, "scheduled"))}
            />
            <FlowColumn
              title={`Checked In (${checkedIn.length})`}
              bg="#FFF8E7"
              items={checkedIn.map((row) => renderCard(row, "checked_in"))}
            />
            <FlowColumn
              title={`Completed (${completed.length})`}
              bg="#F0FFF4"
              items={completed.map((row) => renderCard(row, "completed"))}
            />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">Week Calendar</h2>
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
                    <p className="text-xs text-neutral-400">No appointments</p>
                  ) : (
                    dayRows.map((row) => {
                      const west = clinicianLabel(row.clinician_id) === "Dr. West";
                      return (
                        <div
                          key={row.id}
                          className="rounded px-2 py-1.5 text-xs text-white"
                          style={{ backgroundColor: west ? "#1A6B8A" : "#7C3AED" }}
                        >
                          <p className="font-medium">{formatTimeEastern(row.start_time)}</p>
                          <p className="truncate">{patientName(row)}</p>
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
}: {
  title: string;
  bg: string;
  items: React.ReactNode[];
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4" style={{ backgroundColor: bg }}>
      <p className="mb-3 text-sm font-semibold text-neutral-800">{title}</p>
      <div className="space-y-3">
        {items.length === 0 ? <p className="text-xs text-neutral-500">No appointments</p> : items}
      </div>
    </div>
  );
}

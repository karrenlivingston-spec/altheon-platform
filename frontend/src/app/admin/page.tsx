"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addDaysToYmd,
  formatTimeEastern,
  getEasternYMD,
  getThisWeekRangeEasternYmd,
  isYmdInInclusiveRange,
} from "@/components/adminEastern";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";
const NY = "America/New_York";

const CLINICIAN_WEST_ID = "fb6fa0fc-78f3-48c0-818b-511ad7a8ee93";
const CLINICIAN_SHARPE_ID = "ee6eaa90-1f90-4af7-85a5-4ae78aea3df7";

type PatientRow = {
  id?: string;
  first_name?: string;
  last_name?: string;
};

type AppointmentRow = {
  id: string;
  clinician_id: string;
  start_time: string;
  status: string;
  created_at?: string;
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
  if (!p) return "—";
  const fn = p.first_name ?? "";
  const ln = p.last_name ?? "";
  const s = `${fn} ${ln}`.trim();
  return s || "—";
}

function serviceName(row: AppointmentRow): string {
  return row.treatment_types?.name ?? "—";
}

function patientInitials(row: AppointmentRow): string {
  const p = row.patients;
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const a = f.charAt(0).toUpperCase();
  const b = l.charAt(0).toUpperCase();
  if (a && b) return `${a}${b}`;
  if (a) return a;
  const name = patientName(row);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  return (name.slice(0, 2).toUpperCase() || "?").slice(0, 2);
}

function formatBookedAt(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    month: "short",
    day: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `Booked ${datePart} at ${timePart}`;
}

function focusBorderColor(clinicianId: string): string {
  return clinicianLabel(clinicianId) === "Dr. West" ? "#1A6B8A" : "#7C3AED";
}

export default function AdminOverviewPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusCheckInBusy, setFocusCheckInBusy] = useState(false);

  const refetchAppointments = useCallback(async () => {
    try {
      const apRes = await fetch(
        `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
      );
      const apJson = apRes.ok ? await apRes.json() : [];
      setAppointments(Array.isArray(apJson) ? apJson : []);
    } catch {
      setAppointments([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchData(silent = false) {
      if (!silent) {
        setLoading(true);
      }
      try {
        const [apRes, ptRes] = await Promise.all([
          fetch(
            `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
          ),
          fetch(`${API_BASE}/patients?clinic_id=${encodeURIComponent(CLINIC_ID)}`),
        ]);
        const apJson = apRes.ok ? await apRes.json() : [];
        const ptJson = ptRes.ok ? await ptRes.json() : [];
        if (!cancelled) {
          setAppointments(Array.isArray(apJson) ? apJson : []);
          setPatients(Array.isArray(ptJson) ? ptJson : []);
        }
      } catch {
        if (!cancelled) {
          setAppointments([]);
          setPatients([]);
        }
      } finally {
        if (!cancelled && !silent) {
          setLoading(false);
        }
      }
    }

    void fetchData(false);

    const interval = setInterval(() => {
      void fetchData(true);
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const todayEasternYmd = useMemo(() => getEasternYMD(new Date()), []);

  const nextFocusAppointment = useMemo(() => {
    /* eslint-disable react-hooks/purity -- "next upcoming" requires wall-clock comparison */
    const nowMs = Date.now();
    /* eslint-enable react-hooks/purity */
    const candidates = appointments.filter((a) => {
      if (String(a.status).toLowerCase() !== "scheduled") return false;
      if (getEasternYMD(new Date(a.start_time)) !== todayEasternYmd) return false;
      return new Date(a.start_time).getTime() > nowMs;
    });
    if (candidates.length === 0) return null;
    return [...candidates].sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )[0];
  }, [appointments, todayEasternYmd]);

  async function handleFocusCheckIn(appointmentId: string) {
    setFocusCheckInBusy(true);
    try {
      const res = await fetch(
        `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/status?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "checked_in" }),
        },
      );
      if (res.ok) {
        await refetchAppointments();
      }
    } finally {
      setFocusCheckInBusy(false);
    }
  }

  const todayAppointments = useMemo(() => {
    return appointments.filter((a) => {
      const ymd = getEasternYMD(new Date(a.start_time));
      return ymd === todayEasternYmd;
    });
  }, [appointments, todayEasternYmd]);

  const weekAppointmentCount = useMemo(() => {
    const { mon, sun } = getThisWeekRangeEasternYmd(new Date());
    return appointments.filter((a) => {
      const ymd = getEasternYMD(new Date(a.start_time));
      return isYmdInInclusiveRange(ymd, mon, sun);
    }).length;
  }, [appointments]);

  const monthAppointmentCount = useMemo(() => {
    const ymd = getEasternYMD(new Date());
    const [yStr, mStr] = ymd.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const mi = m - 1;
    const lastDay = new Date(y, mi + 1, 0).getDate();
    const start = `${yStr}-${mStr}-01`;
    const end = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
    return appointments.filter((a) => {
      const d = getEasternYMD(new Date(a.start_time));
      return d >= start && d <= end;
    }).length;
  }, [appointments]);

  const todayCount = todayAppointments.length;
  const patientCount = patients.length;

  return (
    <div className="w-full">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Overview</h1>
      <p className="mb-8 text-sm tracking-wide text-gray-500">
        Snapshot for clinic operations. Data loads from the live API.
      </p>

      <section className="mb-8">
        {loading ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-500">Loading…</p>
          </div>
        ) : nextFocusAppointment ? (
          <div
            className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            style={{
              borderLeftWidth: "4px",
              borderLeftStyle: "solid",
              borderLeftColor: focusBorderColor(nextFocusAppointment.clinician_id),
            }}
          >
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {"Today's Focus"}
            </p>
            <div className="my-4 border-t border-gray-100" />
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Next Appointment
            </p>
            <p className="mt-2 text-lg font-semibold text-gray-900">
              {formatTimeEastern(nextFocusAppointment.start_time)} ·{" "}
              {patientName(nextFocusAppointment)} · {serviceName(nextFocusAppointment)}
            </p>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
              <p className="text-sm text-gray-500">
                {clinicianLabel(nextFocusAppointment.clinician_id)}
              </p>
              <button
                type="button"
                disabled={focusCheckInBusy}
                onClick={() => void handleFocusCheckIn(nextFocusAppointment.id)}
                className="rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {focusCheckInBusy ? "Checking in…" : "Check In"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {"Today's Focus"}
            </p>
            <div className="my-4 border-t border-gray-100" />
            <p className="text-sm text-gray-500">
              All caught up — no more appointments today.
            </p>
          </div>
        )}
      </section>

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={"Today's Appointments"}
          value={loading ? "…" : String(todayCount)}
        />
        <StatCard
          label={"This Week's Appointments"}
          value={loading ? "…" : String(weekAppointmentCount)}
        />
        <StatCard
          label="Total Patients"
          value={loading ? "…" : String(patientCount)}
        />
        <StatCard
          label={"This Month's Appointments"}
          value={loading ? "…" : String(monthAppointmentCount)}
        />
      </div>

      <section className="mb-8">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-gray-500">
          Next 3 Days
        </h2>
        <MiniCalendarStrip appointments={appointments} loading={loading} />
      </section>

      <section>
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-gray-500">
          Recent Activity
        </h2>
        <RecentActivityFeed appointments={appointments} loading={loading} />
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <p className="text-3xl font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
    </div>
  );
}

function MiniCalendarStrip({
  appointments,
  loading,
}: {
  appointments: AppointmentRow[];
  loading: boolean;
}) {
  const todayYmd = getEasternYMD(new Date());
  const dayKeys = [todayYmd, 1, 2].map((d) =>
    typeof d === "string" ? d : addDaysToYmd(todayYmd, d),
  );

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {dayKeys.map((ymd) => {
        const rows = appointments
          .filter((a) => getEasternYMD(new Date(a.start_time)) === ymd)
          .sort(
            (a, b) =>
              new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
          );
        const label = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "numeric",
          day: "numeric",
        }).format(
          new Date(
            Date.UTC(
              Number(ymd.slice(0, 4)),
              Number(ymd.slice(5, 7)) - 1,
              Number(ymd.slice(8, 10)),
              15,
              0,
              0,
            ),
          ),
        );

        return (
          <div
            key={ymd}
            className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
          >
            <p className="mb-4 text-sm font-semibold text-gray-900">{label}</p>
            {loading ? (
              <p className="text-xs text-neutral-500">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-neutral-400">
                No appointments scheduled
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5 text-xs transition-colors hover:bg-gray-50"
                    style={{
                      borderLeftColor:
                        clinicianLabel(row.clinician_id) === "Dr. West"
                          ? "#1A6B8A"
                          : "#7C3AED",
                      borderLeftWidth: "4px",
                    }}
                  >
                    <p className="font-medium text-neutral-900">
                      {formatTimeEastern(row.start_time)}
                    </p>
                    <p className="text-neutral-700">{patientName(row)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RecentActivityFeed({
  appointments,
  loading,
}: {
  appointments: AppointmentRow[];
  loading: boolean;
}) {
  const items = useMemo(() => {
    return [...appointments]
      .filter((a) => a.created_at)
      .sort(
        (a, b) =>
          new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime(),
      )
      .slice(0, 8);
  }, [appointments]);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      {loading ? (
        <p className="p-6 text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="p-6 text-sm text-gray-500">No recent bookings.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((row) => {
            const west = clinicianLabel(row.clinician_id) === "Dr. West";
            const dotColor = west ? "#1A6B8A" : "#7C3AED";
            return (
              <li
                key={row.id}
                className="flex gap-3 px-6 py-4 transition-colors hover:bg-gray-50"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-semibold text-emerald-800"
                  aria-hidden
                >
                  {patientInitials(row)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {patientName(row)}
                  </p>
                  <p className="text-xs text-gray-600">{serviceName(row)}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: dotColor }}
                      aria-hidden
                    />
                    <span>{clinicianLabel(row.clinician_id)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {row.created_at ? formatBookedAt(row.created_at) : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatTimeEastern,
  getEasternYMD,
  getThisWeekRangeEasternYmd,
  isYmdInInclusiveRange,
} from "@/components/adminEastern";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";

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
  if (!p) return "—";
  const fn = p.first_name ?? "";
  const ln = p.last_name ?? "";
  const s = `${fn} ${ln}`.trim();
  return s || "—";
}

function serviceName(row: AppointmentRow): string {
  return row.treatment_types?.name ?? "—";
}

export default function AdminOverviewPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
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
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const todayEasternYmd = useMemo(() => getEasternYMD(new Date()), []);

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

  const todayCount = todayAppointments.length;
  const patientCount = patients.length;

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-900">Overview</h1>
      <p className="mb-8 text-sm text-neutral-600">
        Snapshot for clinic operations. Data loads from the live API.
      </p>

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-5 shadow-sm">
          <p className="text-3xl font-semibold tabular-nums text-neutral-400">
            —
          </p>
          <p className="mt-2 text-sm font-medium text-neutral-500">Members</p>
          <p className="mt-1 text-xs text-neutral-400">Coming Soon</p>
        </div>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-neutral-900">
          {"Today's schedule"}
        </h2>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
          {todayAppointments.length === 0 && !loading ? (
            <p className="p-8 text-center text-sm text-neutral-600">
              No appointments scheduled for today.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-200 text-left text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Time
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Patient Name
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Clinician
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Service
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-8 text-center text-neutral-500"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : (
                    [...todayAppointments]
                      .sort(
                        (a, b) =>
                          new Date(a.start_time).getTime() -
                          new Date(b.start_time).getTime(),
                      )
                      .map((row) => (
                        <tr key={row.id} className="hover:bg-neutral-50/80">
                          <td className="whitespace-nowrap px-4 py-3 text-neutral-900">
                            {formatTimeEastern(row.start_time)}
                          </td>
                          <td className="px-4 py-3 text-neutral-900">
                            {patientName(row)}
                          </td>
                          <td className="px-4 py-3 text-neutral-900">
                            {clinicianLabel(row.clinician_id)}
                          </td>
                          <td className="px-4 py-3 text-neutral-900">
                            {serviceName(row)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full border border-[#2D5E3F]/25 bg-[#2D5E3F]/10 px-2.5 py-0.5 text-xs font-medium text-[#2D5E3F]">
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-3xl font-semibold tabular-nums text-neutral-900">
        {value}
      </p>
      <p className="mt-2 text-sm font-medium text-neutral-600">{label}</p>
    </div>
  );
}

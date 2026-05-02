"use client";

import { useEffect, useMemo, useState } from "react";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";

const NY = "America/New_York";

type PatientRow = {
  id: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  email?: string | null;
};

type AppointmentRow = {
  id: string;
  patient_id: string;
  start_time: string;
};

function getEasternYMD(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mo = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${mo}-${day}`;
}

function addDaysToYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + delta, 12, 0, 0);
  return getEasternYMD(new Date(t));
}

function formatAppointmentDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function patientDisplayName(p: PatientRow): string {
  const s = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return s || "—";
}

function normalizePhone(s: string): string {
  return s.replace(/\D/g, "");
}

export default function AdminPatientsPage() {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ptRes, apRes] = await Promise.all([
          fetch(`${API_BASE}/patients?clinic_id=${encodeURIComponent(CLINIC_ID)}`),
          fetch(
            `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
          ),
        ]);
        const ptJson = ptRes.ok ? await ptRes.json() : [];
        const apJson = apRes.ok ? await apRes.json() : [];
        if (!cancelled) {
          setPatients(Array.isArray(ptJson) ? ptJson : []);
          setAppointments(Array.isArray(apJson) ? apJson : []);
        }
      } catch {
        if (!cancelled) {
          setPatients([]);
          setAppointments([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const statsByPatient = useMemo(() => {
    const map = new Map<
      string,
      { first: Date | null; last: Date | null; count: number }
    >();
    for (const a of appointments) {
      const pid = a.patient_id;
      if (!pid) continue;
      const t = new Date(a.start_time);
      if (Number.isNaN(t.getTime())) continue;
      const cur = map.get(pid) ?? { first: null, last: null, count: 0 };
      cur.count += 1;
      if (!cur.first || t < cur.first) cur.first = t;
      if (!cur.last || t > cur.last) cur.last = t;
      map.set(pid, cur);
    }
    return map;
  }, [appointments]);

  const todayEasternYmd = useMemo(() => getEasternYMD(new Date()), []);
  const windowEndYmd = useMemo(() => addDaysToYmd(todayEasternYmd, 14), [todayEasternYmd]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qPhone = normalizePhone(search);
    return patients
      .filter((p) => {
        if (!q && !qPhone) return true;
        const name = patientDisplayName(p).toLowerCase();
        const phone = String(p.phone ?? "");
        const phoneNorm = normalizePhone(phone);
        if (q && (name.includes(q) || phone.toLowerCase().includes(q)))
          return true;
        if (qPhone && phoneNorm.includes(qPhone)) return true;
        return false;
      })
      .map((p) => {
        const s = statsByPatient.get(p.id);
        const firstSeen =
          s?.first != null ? formatAppointmentDate(s.first.toISOString()) : "—";
        const lastSeen =
          s?.last != null ? formatAppointmentDate(s.last.toISOString()) : "—";
        const totalVisits = s?.count ?? 0;

        let active = false;
        for (const a of appointments) {
          if (a.patient_id !== p.id) continue;
          const ymd = getEasternYMD(new Date(a.start_time));
          if (ymd >= todayEasternYmd && ymd <= windowEndYmd) {
            active = true;
            break;
          }
        }

        return {
          patient: p,
          firstSeen,
          lastSeen,
          totalVisits,
          active,
        };
      })
      .sort((a, b) =>
        patientDisplayName(a.patient).localeCompare(
          patientDisplayName(b.patient),
        ),
      );
  }, [patients, appointments, search, statsByPatient, todayEasternYmd, windowEndYmd]);

  const total = patients.length;

  return (
    <div className="w-full">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Patients</h1>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <p className="text-sm tracking-wide text-gray-500">
          Directory and visit history
        </p>
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          {loading ? "…" : `${total} patient${total === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-100 bg-white px-6 py-4 shadow-sm">
        <input
          type="search"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full max-w-md rounded-lg border border-gray-100 bg-white px-3 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          aria-label="Search patients"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-white">
              <tr>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Phone
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Email
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  First Seen
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Last Seen
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Total Visits
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-10 text-center text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-10 text-center text-gray-500"
                  >
                    No patients match your search.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.patient.id}
                    className="transition-colors hover:bg-gray-100"
                  >
                    <td className="px-6 py-4 font-semibold text-gray-900">
                      {patientDisplayName(row.patient)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-800">
                      {row.patient.phone ?? "—"}
                    </td>
                    <td className="px-6 py-4 text-gray-700">
                      {row.patient.email?.trim() ? row.patient.email : "—"}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-700">
                      {row.firstSeen}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-700">
                      {row.lastSeen}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-gray-800">
                      {row.totalVisits}
                    </td>
                    <td className="px-6 py-4">
                      {row.active ? (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                          Inactive
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

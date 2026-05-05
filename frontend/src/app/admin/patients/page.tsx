"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import {
  activeInactiveBadgeClass,
  DS_FILTER_BAR,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TD_SECONDARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";

import { useAdminClinic } from "@/app/admin/AdminClinicContext";

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

function patientInitials(p: PatientRow): string {
  const a = (p.first_name ?? "").trim().charAt(0);
  const b = (p.last_name ?? "").trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s || "?";
}

export default function AdminPatientsPage() {
  const { clinicId } = useAdminClinic();
  const router = useRouter();
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ptRes, apRes] = await Promise.all([
          fetch(`${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}`),
          fetch(
            `${API_BASE}/appointments?clinic_id=${encodeURIComponent(clinicId)}`,
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
  }, [clinicId]);

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
    <div className={DS_PAGE_ROOT}>
      <h1 className={DS_PAGE_TITLE}>Patients</h1>
      <p className={DS_PAGE_SUBTITLE}>Directory and visit history</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          {loading ? "…" : `${total} patient${total === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className={`${DS_FILTER_BAR} mt-8`}>
        <input
          type="search"
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${DS_INPUT} max-w-md`}
          aria-label="Search patients"
        />
      </div>

      <div className={`${DS_TABLE_WRAP} mt-8`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Name</th>
                <th className={DS_TH}>Phone</th>
                <th className={DS_TH}>Email</th>
                <th className={DS_TH}>First Seen</th>
                <th className={DS_TH}>Last Seen</th>
                <th className={`${DS_TH} text-right`}>Total Visits</th>
                <th className={DS_TH}>Status</th>
                <th className="w-10 px-2 py-3" aria-hidden />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-sm text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-sm text-gray-500"
                  >
                    No patients match your search.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.patient.id}
                    role="button"
                    tabIndex={0}
                    className={`${DS_TR} cursor-pointer`}
                    onClick={() =>
                      router.push(
                        `/admin/patients/${encodeURIComponent(row.patient.id)}`,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(
                          `/admin/patients/${encodeURIComponent(row.patient.id)}`,
                        );
                      }
                    }}
                  >
                    <td className={DS_TD_PRIMARY}>
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-50 text-sm font-medium text-green-700">
                          {patientInitials(row.patient)}
                        </span>
                        <span className="font-medium">
                          {patientDisplayName(row.patient)}
                        </span>
                      </div>
                    </td>
                    <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                      {row.patient.phone ?? "—"}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {row.patient.email?.trim() ? row.patient.email : "—"}
                    </td>
                    <td className={`${DS_TD_SECONDARY} whitespace-nowrap`}>
                      {row.firstSeen}
                    </td>
                    <td className={`${DS_TD_SECONDARY} whitespace-nowrap`}>
                      {row.lastSeen}
                    </td>
                    <td className={`${DS_TD_PRIMARY} text-right tabular-nums`}>
                      {row.totalVisits}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <span className={activeInactiveBadgeClass(row.active)}>
                        {row.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-2 py-4 text-gray-400" aria-hidden>
                      <ChevronRight className="h-5 w-5 shrink-0" />
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

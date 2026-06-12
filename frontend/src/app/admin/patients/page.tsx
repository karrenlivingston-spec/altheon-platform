"use client";

import { useEffect, useMemo, useState } from "react";
import { User } from "lucide-react";

import { PatientDetailView } from "@/components/admin/PatientDetailView";
import { useClinic } from "@/app/admin/ClinicContext";
import { DS_INPUT, DS_PAGE_SUBTITLE, DS_PAGE_TITLE } from "@/app/admin/designSystem";

const API_BASE = "https://altheon-platform.onrender.com";

const NY = "America/New_York";

type PatientRow = {
  id: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  email?: string | null;
  created_at?: string | null;
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

function formatFirstSeenDate(iso: string): string {
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
  const { clinicId } = useClinic();
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    patientId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ptRes, apRes] = await Promise.all([
          fetch(`${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}`),
          fetch(`${API_BASE}/appointments?clinic_id=${encodeURIComponent(clinicId)}`),
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
    const map = new Map<string, { first: Date | null; count: number }>();
    for (const a of appointments) {
      const pid = a.patient_id;
      if (!pid) continue;
      const t = new Date(a.start_time);
      if (Number.isNaN(t.getTime())) continue;
      const cur = map.get(pid) ?? { first: null, count: 0 };
      cur.count += 1;
      if (!cur.first || t < cur.first) cur.first = t;
      map.set(pid, cur);
    }
    return map;
  }, [appointments]);

  const todayEasternYmd = useMemo(() => getEasternYMD(new Date()), []);
  const windowEndYmd = useMemo(() => {
    const [y, m, d] = todayEasternYmd.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d + 14, 12, 0, 0);
    return getEasternYMD(new Date(t));
  }, [todayEasternYmd]);

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qPhone = normalizePhone(search);
    return patients
      .filter((p) => {
        if (!q && !qPhone) return true;
        const name = patientDisplayName(p).toLowerCase();
        const phone = String(p.phone ?? "");
        const phoneNorm = normalizePhone(phone);
        if (q && (name.includes(q) || phone.toLowerCase().includes(q))) return true;
        if (qPhone && phoneNorm.includes(qPhone)) return true;
        return false;
      })
      .sort((a, b) => patientDisplayName(a).localeCompare(patientDisplayName(b)));
  }, [patients, search]);

  const filteredCount = filteredList.length;

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col md:flex-row md:min-h-[calc(100vh-8rem)]">
      <aside
        className={`flex w-full shrink-0 flex-col border-[#e2e8f0] bg-white md:w-[320px] md:border-r ${
          selectedId ? "hidden md:flex" : "flex"
        }`}
        style={{ maxHeight: "100%" }}
      >
        <div className="border-b border-[#e2e8f0] p-4">
          <h1 className={DS_PAGE_TITLE}>Patients</h1>
          <p className={DS_PAGE_SUBTITLE}>Directory and visit history</p>
          <input
            type="search"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${DS_INPUT} mt-4 w-full`}
            aria-label="Search patients"
          />
          <p className="mt-2 text-sm text-[#64748b]">
            {loading ? "…" : `${filteredCount} patient${filteredCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-[#64748b]">Loading…</p>
          ) : filteredList.length === 0 ? (
            <p className="p-4 text-sm text-[#64748b]">No patients match your search.</p>
          ) : (
            <ul className="divide-y divide-[#e2e8f0]">
              {filteredList.map((p) => {
                const s = statsByPatient.get(p.id);
                const firstSeen =
                  s?.first != null
                    ? formatFirstSeenDate(s.first.toISOString())
                    : p.created_at
                      ? formatFirstSeenDate(p.created_at)
                      : null;
                let active = false;
                for (const a of appointments) {
                  if (a.patient_id !== p.id) continue;
                  const ymd = getEasternYMD(new Date(a.start_time));
                  if (ymd >= todayEasternYmd && ymd <= windowEndYmd) {
                    active = true;
                    break;
                  }
                }
                const selected = selectedId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          patientId: p.id,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                      className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(22,163,74,0.06)] ${
                        selected
                          ? "border-l-[3px] border-l-[#16A34A] bg-[rgba(22,163,74,0.12)]"
                          : "border-l-[3px] border-l-transparent"
                      } `}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                        style={{ backgroundColor: "#16A34A" }}
                      >
                        {patientInitials(p)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate font-semibold text-[#0f172a]">
                            {patientDisplayName(p)}
                          </p>
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              active ? "bg-[#16A34A]" : "bg-gray-300"
                            }`}
                            title={active ? "Active" : "Inactive"}
                          />
                        </div>
                        <p className="mt-0.5 text-[0.8rem] text-[#64748b]">
                          {p.phone?.trim() || "—"}
                        </p>
                        {firstSeen ? (
                          <p className="mt-0.5 text-[0.8rem] text-[#64748b]">
                            First seen {firstSeen}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section
        className={`min-h-0 flex-1 bg-[#f8fafc] ${
          selectedId ? "flex" : "hidden md:flex"
        } flex-col`}
      >
        {!selectedId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
            <User className="h-16 w-16 text-gray-300" strokeWidth={1.25} />
            <p className="mt-4 text-sm font-medium text-[#64748b]">
              Select a patient to view their profile
            </p>
          </div>
        ) : (
          <PatientDetailView
            patientId={selectedId}
            clinicId={clinicId}
            embedded
            onBack={() => setSelectedId(null)}
          />
        )}
      </section>

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[168px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
            onClick={() => {
              window.open(`/admin/patients/${contextMenu.patientId}`, "_blank");
              setContextMenu(null);
            }}
          >
            Open in new tab
          </button>
        </div>
      ) : null}
    </div>
  );
}

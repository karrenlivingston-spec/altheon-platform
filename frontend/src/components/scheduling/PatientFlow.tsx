"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CircleCheck, User } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";

type FlowStats = {
  total: number;
  new_patients: number;
  scheduled: number;
  checked_in: number;
  completed: number;
  cancelled: number;
  no_show: number;
  rescheduled: number;
};

type FlowAppointment = {
  id: string;
  start_time: string;
  duration_minutes: number;
  status: string;
  source: string;
  is_new_patient: boolean;
  location_id?: string | null;
  patient: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  };
  clinician: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    title?: string | null;
    color?: string | null;
  };
  treatment_type: {
    name?: string | null;
    duration_minutes?: number | null;
  };
};

type FlowResponse = {
  date: string;
  stats: FlowStats;
  appointments: FlowAppointment[];
};

type ClinicianOption = { id: string; first_name?: string | null; last_name?: string | null };
type LocationOption = { id: string; name?: string | null };

const EMPTY_STATS: FlowStats = {
  total: 0,
  new_patients: 0,
  scheduled: 0,
  checked_in: 0,
  completed: 0,
  cancelled: 0,
  no_show: 0,
  rescheduled: 0,
};

function formatDateHeader(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function shiftDate(ymd: string, days: number) {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function statusToColumn(status: string): "today" | "checked_in" | "seen" | "hidden" {
  const s = status.toLowerCase();
  if (s === "checked_in") return "checked_in";
  if (s === "completed") return "seen";
  if (s === "scheduled" || s === "confirmed" || s === "rescheduled") return "today";
  return "hidden";
}

function formatClock(startHHMM: string) {
  const [hRaw, mRaw] = startHHMM.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return startHHMM;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function clinicianFull(c: FlowAppointment["clinician"]) {
  const last = (c.last_name ?? "").trim();
  const first = (c.first_name ?? "").trim();
  const t = (c.title ?? "").trim();
  const label = last ? `Dr. ${last}` : first ? `Dr. ${first}` : "Clinician";
  return t ? `${label}, ${t}` : label;
}

function patientFull(p: FlowAppointment["patient"]) {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown Patient";
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function PatientFlow() {
  const { clinicId } = useClinic();
  const [dateYmd, setDateYmd] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<FlowAppointment[]>([]);
  const [stats, setStats] = useState<FlowStats>(EMPTY_STATS);
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [selectedClinician, setSelectedClinician] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [clinRes, locRes] = await Promise.all([
        supabase
          .from("clinicians")
          .select("id,first_name,last_name")
          .eq("clinic_id", clinicId)
          .order("last_name", { ascending: true }),
        supabase
          .from("locations")
          .select("id,name")
          .eq("clinic_id", clinicId)
          .order("name", { ascending: true }),
      ]);
      if (cancelled) return;
      setClinicians((clinRes.data as ClinicianOption[]) ?? []);
      setLocations((locRes.data as LocationOption[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  async function loadFlow() {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${API_BASE}/appointments/patient-flow?clinic_id=${encodeURIComponent(clinicId)}&date=${encodeURIComponent(dateYmd)}`,
        { headers },
      );
      const data = (res.ok ? await res.json() : null) as FlowResponse | null;
      setAppointments(data?.appointments ?? []);
      setStats(data?.stats ?? EMPTY_STATS);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFlow();
  }, [clinicId, dateYmd]);

  const visible = useMemo(() => {
    return appointments
      .filter((a) => (selectedClinician === "all" ? true : a.clinician.id === selectedClinician))
      .filter((a) => (selectedLocation === "all" ? true : (a.location_id ?? "") === selectedLocation))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }, [appointments, selectedClinician, selectedLocation]);

  const colToday = visible.filter((a) => statusToColumn(a.status) === "today");
  const colCheckedIn = visible.filter((a) => statusToColumn(a.status) === "checked_in");
  const colSeen = visible.filter((a) => statusToColumn(a.status) === "seen");

  async function patchStatus(id: string, status: "checked_in" | "completed" | "no_show" | "cancelled") {
    setBusyIds((p) => ({ ...p, [id]: true }));
    const prev = appointments;
    setAppointments((p) =>
      p.map((a) => (a.id === id ? { ...a, status } : a)),
    );
    setStats((s) => {
      const next = { ...s };
      if (status === "checked_in") {
        next.checked_in += 1;
        next.scheduled = Math.max(0, next.scheduled - 1);
      } else if (status === "completed") {
        next.completed += 1;
        next.checked_in = Math.max(0, next.checked_in - 1);
      } else if (status === "no_show") {
        next.no_show += 1;
        next.scheduled = Math.max(0, next.scheduled - 1);
      } else if (status === "cancelled") {
        next.cancelled += 1;
        next.checked_in = Math.max(0, next.checked_in - 1);
      }
      return next;
    });
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/appointments/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setAppointments(prev);
        await loadFlow();
      }
    } catch {
      setAppointments(prev);
      await loadFlow();
    } finally {
      setBusyIds((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }

  function renderCard(a: FlowAppointment, col: "today" | "checked_in" | "seen") {
    const clinicianColor = (a.clinician.color ?? "").trim() || "#16A34A";
    const busy = !!busyIds[a.id];
    return (
      <div
        key={a.id}
        className="rounded-xl border border-black/10 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all duration-150 ease-in hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(0,0,0,0.10)]"
        style={{ borderLeft: `4px solid ${clinicianColor}` }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-900">{formatClock(a.start_time)}</span>
          <span className="text-xs text-slate-500">{a.duration_minutes} min</span>
          {a.is_new_patient ? (
            <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-xs font-medium text-[#92400E]">
              New Patient
            </span>
          ) : null}
          {a.source === "ai" ? (
            <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-xs font-medium text-[#475569]">
              Aria
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-lg font-semibold text-slate-900">{patientFull(a.patient)}</p>
        <p className="text-sm text-slate-500">{a.treatment_type.name || "Visit"}</p>
        <p className="mt-2 text-xs text-slate-500">{clinicianFull(a.clinician)}</p>
        {col === "today" ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void patchStatus(a.id, "checked_in")}
              className="rounded-lg border-[1.5px] border-[var(--color-primary,#16A34A)] px-3 py-1.5 text-sm font-medium text-[var(--color-primary,#16A34A)] transition-all duration-150 ease-in hover:-translate-y-px hover:bg-[#f0fdf4] disabled:opacity-50"
            >
              Check In
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void patchStatus(a.id, "no_show")}
              className="text-xs font-medium text-[#DC2626] hover:text-red-700 disabled:opacity-50"
            >
              No Show
            </button>
          </div>
        ) : null}
        {col === "checked_in" ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void patchStatus(a.id, "completed")}
              className="rounded-lg border-[1.5px] border-[#7C3AED] px-3 py-1.5 text-sm font-medium text-[#7C3AED] transition-all duration-150 ease-in hover:-translate-y-px hover:bg-violet-50 disabled:opacity-50"
            >
              Mark Complete
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void patchStatus(a.id, "cancelled")}
              className="text-xs font-medium text-[#DC2626] hover:text-red-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : null}
        {col === "seen" ? (
          <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
            <CircleCheck className="h-3.5 w-3.5" />
            Completed
          </div>
        ) : null}
      </div>
    );
  }

  function renderColumn(
    title: string,
    accent: string,
    bg: string,
    items: FlowAppointment[],
    kind: "today" | "checked_in" | "seen",
  ) {
    return (
      <div className={`min-h-[520px] rounded-xl ${bg} p-4`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className={`text-sm font-semibold ${accent}`}>{title}</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${accent} bg-white/80`}>
            {items.length}
          </span>
        </div>
        {loading ? (
          <div className="space-y-3">
            <div className="h-28 animate-pulse rounded-lg bg-white/80" />
            <div className="h-28 animate-pulse rounded-lg bg-white/80" />
            <div className="h-28 animate-pulse rounded-lg bg-white/80" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-slate-400">
            <User className="h-5 w-5" />
            <p className="text-sm">No patients</p>
          </div>
        ) : (
          <div className="space-y-3">{items.map((a) => renderCard(a, kind))}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDateYmd((d) => shiftDate(d, -1))}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-semibold text-slate-900">{formatDateHeader(dateYmd)}</p>
          <button
            type="button"
            onClick={() => setDateYmd((d) => shiftDate(d, 1))}
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedClinician}
            onChange={(e) => setSelectedClinician(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All Clinicians</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.last_name ?? ""}, ${c.first_name ?? ""}`.replace(/^,\s*/, "")}
              </option>
            ))}
          </select>
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {renderColumn("Today's Appointments", "text-[#3B82F6]", "bg-[#EFF6FF]", colToday, "today")}
        {renderColumn("Checked In", "text-[#16A34A]", "bg-[#F0FDF4]", colCheckedIn, "checked_in")}
        {renderColumn("Patients Seen Today", "text-[#7C3AED]", "bg-[#F5F3FF]", colSeen, "seen")}
      </div>

      <div className="rounded-xl bg-[#0B1A2B] px-4 py-3 text-white">
        <div className="grid grid-cols-4 gap-3 md:grid-cols-8">
          {[
            ["Total", stats.total],
            ["New Patients", stats.new_patients],
            ["Scheduled", stats.scheduled],
            ["Checked In", stats.checked_in],
            ["Completed", stats.completed],
            ["Rescheduled", stats.rescheduled],
            ["Canceled", stats.cancelled],
            ["No Show", stats.no_show],
          ].map(([label, value]) => (
            <div key={label as string} className="border-r border-white/15 pr-2 last:border-r-0">
              <p className="text-lg font-semibold">{value as number}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-300">{label as string}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


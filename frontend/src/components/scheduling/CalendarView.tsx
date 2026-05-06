"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { formatInTimeZone, toDate } from "date-fns-tz";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addDaysToYmd,
  findMondayYmdOfWeekContaining,
  getEasternYMD,
} from "@/components/adminEastern";
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";
const NY = "America/New_York";
const ROW_H = 60;
const GRID_START_HOUR = 7;
const GRID_END_HOUR = 19;
const SLOT_MINUTES = 30;
const NUM_SLOTS = ((GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES;

export type CalendarAppointment = {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  source: string;
  location_id?: string;
  is_new_patient?: boolean;
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

type ClinicianRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  color?: string | null;
};

type LocationRow = { id: string; name?: string | null };

type BlockedRow = {
  id: string;
  clinician_id: string;
  start_time: string;
  end_time: string;
  reason?: string | null;
};

type ViewMode = "day" | "week" | "month";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function slotStartToUtcIso(ymd: string, slotIndex: number): string {
  const minutesFrom7am = slotIndex * SLOT_MINUTES;
  const h = GRID_START_HOUR + Math.floor(minutesFrom7am / 60);
  const m = minutesFrom7am % 60;
  const s = `${ymd}T${pad2(h)}:${pad2(m)}:00`;
  return toDate(s, { timeZone: NY }).toISOString();
}

function moveDatePreserveEasternTime(isoUtc: string, newYmd: string): string {
  const h = Number(formatInTimeZone(new Date(isoUtc), NY, "H"));
  const min = Number(formatInTimeZone(new Date(isoUtc), NY, "m"));
  const s = `${newYmd}T${pad2(h)}:${pad2(min)}:00`;
  return toDate(s, { timeZone: NY }).toISOString();
}

function easternYmdOfIso(iso: string): string {
  return formatInTimeZone(new Date(iso), NY, "yyyy-MM-dd");
}

function minutesFromGridStart(iso: string): number {
  const h = Number(formatInTimeZone(new Date(iso), NY, "H"));
  const m = Number(formatInTimeZone(new Date(iso), NY, "m"));
  return h * 60 + m - GRID_START_HOUR * 60;
}

function clinicianLabel(c: ClinicianRow): string {
  const last = (c.last_name ?? "").trim();
  const first = (c.first_name ?? "").trim();
  if (last) return `${first} ${last}`.trim() || last;
  return first || c.id;
}

function patientFull(a: CalendarAppointment): string {
  return `${a.patient.first_name ?? ""} ${a.patient.last_name ?? ""}`.trim() || "Patient";
}

function statusDotClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "checked_in") return "bg-[#16A34A]";
  if (s === "completed") return "bg-[#7C3AED]";
  if (s === "cancelled") return "bg-[#DC2626]";
  return "bg-slate-400";
}

function monthGridRange(anchorYmd: string): { start: string; end: string } {
  const [y, mo] = anchorYmd.split("-").map(Number);
  const first = `${y}-${pad2(mo)}-01`;
  const lastD = new Date(y, mo, 0).getDate();
  const end = `${y}-${pad2(mo)}-${pad2(lastD)}`;
  return { start: first, end };
}

function monthCalendarCells(anchorYmd: string): { ymd: string; inMonth: boolean }[][] {
  const [y, mo] = anchorYmd.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const startDow = first.getDay();
  const lastD = new Date(y, mo, 0).getDate();
  const cells: { ymd: string; inMonth: boolean }[] = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(y, mo - 1, 1 - (startDow - i));
    cells.push({
      ymd: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      inMonth: false,
    });
  }
  for (let d = 1; d <= lastD; d++) {
    cells.push({ ymd: `${y}-${pad2(mo)}-${pad2(d)}`, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const [yy, mm, dd] = last.ymd.split("-").map(Number);
    const n = new Date(yy, mm - 1, dd + 1);
    cells.push({
      ymd: `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`,
      inMonth: false,
    });
  }
  const rows: { ymd: string; inMonth: boolean }[][] = [];
  for (let r = 0; r < cells.length / 7; r++) {
    rows.push(cells.slice(r * 7, r * 7 + 7));
  }
  return rows;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function overlapsRange(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean {
  return startA < endB && endA > startB;
}

type CalendarViewProps = {
  clinicId: string;
};

export default function CalendarView({ clinicId }: CalendarViewProps) {
  const [view, setView] = useState<ViewMode>("week");
  const [anchorYmd, setAnchorYmd] = useState(() => getEasternYMD(new Date()));
  const [providerId, setProviderId] = useState<string>("");
  const [locationId, setLocationId] = useState<string>("");
  const [clinicians, setClinicians] = useState<ClinicianRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [blocked, setBlocked] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDrag, setActiveDrag] = useState<CalendarAppointment | null>(null);
  const [undo, setUndo] = useState<{ apptId: string; prevStart: string } | null>(null);
  const [swapDialog, setSwapDialog] = useState<{
    a: CalendarAppointment;
    b: CalendarAppointment;
    targetSlot: { ymd: string; clinicianId: string; slotIndex: number };
  } | null>(null);
  const [weekMoveDialog, setWeekMoveDialog] = useState<{
    appt: CalendarAppointment;
    newYmd: string;
  } | null>(null);
  const [blockPopover, setBlockPopover] = useState<{
    ymd: string;
    clinicianId: string;
    slotIndex: number;
  } | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [detailAppt, setDetailAppt] = useState<CalendarAppointment | null>(null);

  const todayYmd = useMemo(() => getEasternYMD(new Date()), []);

  const range = useMemo(() => {
    if (view === "day") return { start: anchorYmd, end: anchorYmd };
    if (view === "week") {
      const mon = findMondayYmdOfWeekContaining(anchorYmd);
      return { start: mon, end: addDaysToYmd(mon, 6) };
    }
    return monthGridRange(anchorYmd);
  }, [view, anchorYmd]);

  const weekDays = useMemo(() => {
    const mon = findMondayYmdOfWeekContaining(anchorYmd);
    return Array.from({ length: 7 }, (_, i) => addDaysToYmd(mon, i));
  }, [anchorYmd]);

  const activeClinicians = useMemo(() => {
    const list = [...clinicians].sort((a, b) =>
      clinicianLabel(a).localeCompare(clinicianLabel(b)),
    );
    if (providerId) return list.filter((c) => c.id === providerId);
    return list;
  }, [clinicians, providerId]);

  const filteredAppointments = useMemo(() => {
    let list = appointments;
    if (providerId) list = list.filter((a) => a.clinician.id === providerId);
    if (locationId) list = list.filter((a) => a.location_id === locationId);
    return list;
  }, [appointments, providerId, locationId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const h = await authHeaders();
      let calUrl = `${API_BASE}/appointments/calendar?start_date=${encodeURIComponent(range.start)}&end_date=${encodeURIComponent(range.end)}&clinic_id=${encodeURIComponent(clinicId)}`;
      if (providerId) {
        calUrl += `&clinician_id=${encodeURIComponent(providerId)}`;
      }
      const [calRes, clinRes, locRes] = await Promise.all([
        fetch(calUrl, { headers: h }),
        fetch(`${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`, { headers: h }),
        supabase.from("locations").select("id,name").eq("clinic_id", clinicId).eq("is_active", true),
      ]);
      const calJson = calRes.ok ? await calRes.json() : { appointments: [] };
      const clinJson = clinRes.ok ? await clinRes.json() : [];
      setAppointments(Array.isArray(calJson.appointments) ? calJson.appointments : []);
      setClinicians(Array.isArray(clinJson) ? clinJson : []);
      setLocations((locRes.data as LocationRow[]) || []);

      if (view === "day") {
        const ids = providerId
          ? [providerId]
          : (Array.isArray(clinJson) ? clinJson : []).map((c: ClinicianRow) => c.id);
        const blocks: BlockedRow[] = [];
        for (const cid of ids) {
          const br = await fetch(
            `${API_BASE}/clinicians/${encodeURIComponent(cid)}/blocked-time?from_date=${encodeURIComponent(anchorYmd)}&to_date=${encodeURIComponent(anchorYmd)}`,
            { headers: h },
          );
          const data = br.ok ? await br.json() : [];
          for (const row of Array.isArray(data) ? data : []) {
            blocks.push({ ...row, clinician_id: cid });
          }
        }
        setBlocked(blocks);
      } else {
        setBlocked([]);
      }
    } catch {
      setAppointments([]);
      setBlocked([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, range.start, range.end, view, anchorYmd, providerId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  const periodLabel = useMemo(() => {
    if (view === "day") {
      const d = new Date(`${anchorYmd}T12:00:00`);
      return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(d);
    }
    if (view === "week") {
      const mon = findMondayYmdOfWeekContaining(anchorYmd);
      const sun = addDaysToYmd(mon, 6);
      const monD = new Date(`${mon}T12:00:00`);
      const sunD = new Date(`${sun}T12:00:00`);
      const a = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(monD);
      const b = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(sunD);
      return `${a} – ${b}`;
    }
    const [y, m] = anchorYmd.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      new Date(y, m - 1, 1),
    );
  }, [view, anchorYmd]);

  function navigatePrev() {
    if (view === "day") setAnchorYmd((y) => addDaysToYmd(y, -1));
    else if (view === "week") setAnchorYmd((y) => addDaysToYmd(y, -7));
    else {
      const [yy, mm] = anchorYmd.split("-").map(Number);
      const d = new Date(yy, mm - 2, 1);
      setAnchorYmd(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`);
    }
  }

  function navigateNext() {
    if (view === "day") setAnchorYmd((y) => addDaysToYmd(y, 1));
    else if (view === "week") setAnchorYmd((y) => addDaysToYmd(y, 7));
    else {
      const [yy, mm] = anchorYmd.split("-").map(Number);
      const d = new Date(yy, mm, 1);
      setAnchorYmd(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`);
    }
  }

  function goToday() {
    setAnchorYmd(getEasternYMD(new Date()));
  }

  async function patchAppointmentTime(apptId: string, startIso: string) {
    const h = await authHeaders();
    const res = await fetch(`${API_BASE}/appointments/${encodeURIComponent(apptId)}/time`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ start_time: startIso }),
    });
    if (!res.ok) throw new Error(String(res.status));
    await loadData();
  }

  async function swapAppointments(id1: string, id2: string) {
    const h = await authHeaders();
    const res = await fetch(`${API_BASE}/appointments/swap`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ appointment_id_1: id1, appointment_id_2: id2 }),
    });
    if (!res.ok) throw new Error(String(res.status));
    await loadData();
  }

  function findApptAtSlot(
    clinicianId: string,
    ymd: string,
    slotIndex: number,
    excludeId?: string,
  ): CalendarAppointment | null {
    const slotStart = toDate(`${ymd}T${pad2(GRID_START_HOUR + Math.floor((slotIndex * SLOT_MINUTES) / 60))}:${pad2((slotIndex * SLOT_MINUTES) % 60)}:00`, {
      timeZone: NY,
    });
    const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60 * 1000);
    for (const a of filteredAppointments) {
      if (excludeId && a.id === excludeId) continue;
      if (a.clinician.id !== clinicianId) continue;
      if (easternYmdOfIso(a.start_time) !== ymd) continue;
      const as = new Date(a.start_time);
      const ae = new Date(a.end_time);
      if (overlapsRange(as, ae, slotStart, slotEnd)) return a;
    }
    return null;
  }

  function findOverlappingAppt(
    list: CalendarAppointment[],
    clinicianId: string,
    newStartIso: string,
    newEndIso: string,
    excludeId?: string,
  ): CalendarAppointment | null {
    const ns = new Date(newStartIso);
    const ne = new Date(newEndIso);
    for (const a of list) {
      if (excludeId && a.id === excludeId) continue;
      if (a.clinician.id !== clinicianId) continue;
      const as = new Date(a.start_time);
      const ae = new Date(a.end_time);
      if (overlapsRange(as, ae, ns, ne)) return a;
    }
    return null;
  }

  function handleDragEnd(ev: DragEndEvent) {
    setActiveDrag(null);
    const activeId = String(ev.active.id);
    if (!activeId.startsWith("appt-")) return;
    const apptId = activeId.slice(5);
    const appt = filteredAppointments.find((x) => x.id === apptId);
    if (!appt || !ev.over) return;
    const overId = String(ev.over.id);

    if (overId.startsWith("slot|")) {
      const [, ymd, clinicianId, slotStr] = overId.split("|");
      const slotIndex = Number(slotStr);
      if (!ymd || !clinicianId || Number.isNaN(slotIndex)) return;
      if (clinicianId !== appt.clinician.id) return;
      const newStart = slotStartToUtcIso(ymd, slotIndex);
      const dur = appt.treatment_type.duration_minutes || 30;
      const newEndIso = new Date(new Date(newStart).getTime() + dur * 60 * 1000).toISOString();
      const other = findOverlappingAppt(
        filteredAppointments,
        clinicianId,
        newStart,
        newEndIso,
        apptId,
      );
      if (other) {
        setSwapDialog({ a: appt, b: other, targetSlot: { ymd, clinicianId, slotIndex } });
        return;
      }
      const prevStart = appt.start_time;
      setAppointments((prev) =>
        prev.map((x) =>
          x.id === apptId ? { ...x, start_time: newStart, end_time: newEndIso } : x,
        ),
      );
      void patchAppointmentTime(apptId, newStart)
        .then(() => setUndo({ apptId, prevStart }))
        .catch(() => {
          void loadData();
        });
      return;
    }

    if (overId.startsWith("weekday-")) {
      const newYmd = overId.slice("weekday-".length);
      if (!newYmd || newYmd === easternYmdOfIso(appt.start_time)) return;
      setWeekMoveDialog({ appt, newYmd });
    }
  }

  function handleDragStart(ev: DragStartEvent) {
    const id = String(ev.active.id);
    if (id.startsWith("appt-")) {
      const a = filteredAppointments.find((x) => x.id === id.slice(5));
      if (a) setActiveDrag(a);
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const viewPill = (v: ViewMode, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={
        view === v
          ? "rounded-full bg-[#16A34A] px-3 py-1.5 text-sm font-medium text-white"
          : "rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
      }
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-xl border border-black/10 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {viewPill("day", "Day")}
            {viewPill("week", "Week")}
            {viewPill("month", "Month")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={navigatePrev}
              className="rounded-lg border border-black/10 px-2 py-1 text-slate-700 hover:bg-slate-50"
            >
              &lt;
            </button>
            <span className="min-w-[200px] text-center text-sm font-semibold text-slate-900">
              {periodLabel}
            </span>
            <button
              type="button"
              onClick={navigateNext}
              className="rounded-lg border border-black/10 px-2 py-1 text-slate-700 hover:bg-slate-50"
            >
              &gt;
            </button>
            <button
              type="button"
              onClick={goToday}
              className="ml-2 rounded-lg border border-[#16A34A]/40 px-3 py-1.5 text-sm font-medium text-[#16A34A] hover:bg-green-50"
            >
              Today
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            className="h-10 min-w-[180px] rounded-lg border border-black/10 bg-white px-3 text-sm"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
          >
            <option value="">All Providers</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>
                {clinicianLabel(c)}
              </option>
            ))}
          </select>
          <select
            className="h-10 min-w-[180px] rounded-lg border border-black/10 bg-white px-3 text-sm"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      {undo ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>Appointment moved.</span>
          <button
            type="button"
            className="font-medium text-amber-800 underline"
            onClick={() => {
              const u = undo;
              setUndo(null);
              if (u) void patchAppointmentTime(u.apptId, u.prevStart);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading calendar…
        </div>
      ) : view === "day" ? (
        <DayGrid
          dayYmd={anchorYmd}
          todayYmd={todayYmd}
          clinicians={activeClinicians}
          appointments={filteredAppointments}
          blocked={blocked}
          onRefresh={() => void loadData()}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          sensors={sensors}
          activeDrag={activeDrag}
          blockPopover={blockPopover}
          setBlockPopover={setBlockPopover}
          blockReason={blockReason}
          setBlockReason={setBlockReason}
          findApptAtSlot={findApptAtSlot}
        />
      ) : view === "week" ? (
        <WeekGrid
          weekDays={weekDays}
          todayYmd={todayYmd}
          appointments={filteredAppointments}
          onDayHeaderClick={(ymd) => {
            setAnchorYmd(ymd);
            setView("day");
          }}
          onCardClick={setDetailAppt}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          sensors={sensors}
          activeDrag={activeDrag}
        />
      ) : (
        <MonthGrid
          anchorYmd={anchorYmd}
          todayYmd={todayYmd}
          appointments={filteredAppointments}
          onDayClick={(ymd) => {
            setAnchorYmd(ymd);
            setView("day");
          }}
        />
      )}

      {swapDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-xl bg-white p-6 shadow-xl">
            <p className="text-sm font-medium text-slate-900">
              Swap {patientFull(swapDialog.a)} and {patientFull(swapDialog.b)}?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-black/10 px-4 py-2 text-sm"
                onClick={() => setSwapDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#16A34A] px-4 py-2 text-sm font-medium text-white"
                onClick={() => {
                  const s = swapDialog;
                  setSwapDialog(null);
                  if (s) void swapAppointments(s.a.id, s.b.id).catch(() => loadData());
                }}
              >
                Swap
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {weekMoveDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-xl bg-white p-6 shadow-xl">
            <p className="text-sm font-medium text-slate-900">
              Move {patientFull(weekMoveDialog.appt)} to{" "}
              {new Date(`${weekMoveDialog.newYmd}T12:00:00`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
              ?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-black/10 px-4 py-2 text-sm"
                onClick={() => setWeekMoveDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#16A34A] px-4 py-2 text-sm font-medium text-white"
                onClick={() => {
                  const w = weekMoveDialog;
                  setWeekMoveDialog(null);
                  if (w) {
                    const iso = moveDatePreserveEasternTime(w.appt.start_time, w.newYmd);
                    void patchAppointmentTime(w.appt.id, iso).catch(() => loadData());
                  }
                }}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailAppt ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <p className="font-semibold text-slate-900">{patientFull(detailAppt)}</p>
            <p className="mt-1 text-sm text-slate-600">
              {formatInTimeZone(new Date(detailAppt.start_time), NY, "h:mm a")} ·{" "}
              {detailAppt.treatment_type.name}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {clinicianLabel({
                id: detailAppt.clinician.id,
                first_name: detailAppt.clinician.first_name,
                last_name: detailAppt.clinician.last_name,
                title: detailAppt.clinician.title,
              })}
            </p>
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-black/10 py-2 text-sm"
              onClick={() => setDetailAppt(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DayGrid({
  dayYmd,
  todayYmd,
  clinicians,
  appointments,
  blocked,
  onRefresh,
  onDragStart,
  onDragEnd,
  sensors,
  activeDrag,
  blockPopover,
  setBlockPopover,
  blockReason,
  setBlockReason,
  findApptAtSlot,
}: {
  dayYmd: string;
  todayYmd: string;
  clinicians: ClinicianRow[];
  appointments: CalendarAppointment[];
  blocked: BlockedRow[];
  onRefresh: () => void;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  activeDrag: CalendarAppointment | null;
  blockPopover: { ymd: string; clinicianId: string; slotIndex: number } | null;
  setBlockPopover: (v: { ymd: string; clinicianId: string; slotIndex: number } | null) => void;
  blockReason: string;
  setBlockReason: (s: string) => void;
  findApptAtSlot: (
    clinicianId: string,
    ymd: string,
    slotIndex: number,
    excludeId?: string,
  ) => CalendarAppointment | null;
}) {
  const gridHeight = NUM_SLOTS * ROW_H;
  const nowLinePx = useMemo(() => {
    if (dayYmd !== todayYmd) return null;
    const now = new Date();
    const mins = minutesFromGridStart(now.toISOString());
    if (mins < 0 || mins > NUM_SLOTS * SLOT_MINUTES) return null;
    return (mins / SLOT_MINUTES) * ROW_H;
  }, [dayYmd, todayYmd]);

  const blockedByClinician = useMemo(() => {
    const m = new Map<string, BlockedRow[]>();
    for (const b of blocked) {
      if (easternYmdOfIso(b.start_time) !== dayYmd && easternYmdOfIso(b.end_time) !== dayYmd)
        continue;
      const list = m.get(b.clinician_id) || [];
      list.push(b);
      m.set(b.clinician_id, list);
    }
    return m;
  }, [blocked, dayYmd]);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="flex min-w-max">
          <div
            className="sticky left-0 z-20 w-16 shrink-0 border-r border-black/10 bg-white"
            style={{ paddingTop: 48 }}
          >
            {Array.from({ length: NUM_SLOTS }, (_, i) => {
              const totalMin = GRID_START_HOUR * 60 + i * SLOT_MINUTES;
              const h = Math.floor(totalMin / 60);
              const m = totalMin % 60;
              const ampm = h >= 12 ? "PM" : "AM";
              const h12 = h % 12 || 12;
              return (
                <div
                  key={i}
                  className="box-border flex items-start justify-end pr-2 text-[11px] text-slate-500"
                  style={{ height: ROW_H }}
                >
                  {m === 0 ? `${h12}:00 ${ampm}` : ""}
                </div>
              );
            })}
          </div>
          {clinicians.map((clin) => {
            const color = clin.color || "#0EA5A4";
            return (
              <div
                key={clin.id}
                className="relative min-w-[200px] shrink-0 border-r border-black/10"
                style={{ width: 200 }}
              >
                <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-black/10 bg-white px-2 py-3">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate text-xs font-semibold text-slate-800">
                    {clinicianLabel(clin)}
                  </span>
                </div>
                <div className="relative" style={{ height: gridHeight }}>
                  {Array.from({ length: NUM_SLOTS }, (_, slotIndex) => (
                    <DroppableSlotCell
                      key={slotIndex}
                      id={`slot|${dayYmd}|${clin.id}|${slotIndex}`}
                      slotIndex={slotIndex}
                      isHighlighted={false}
                      onEmptyClick={() => {
                        if (!findApptAtSlot(clin.id, dayYmd, slotIndex))
                          setBlockPopover({ ymd: dayYmd, clinicianId: clin.id, slotIndex });
                      }}
                    />
                  ))}
                  {nowLinePx !== null ? (
                    <div
                      className="pointer-events-none absolute right-0 left-0 z-30 border-t-2 border-red-500"
                      style={{ top: nowLinePx }}
                    />
                  ) : null}
                  {(blockedByClinician.get(clin.id) || []).map((b) => (
                    <BlockedOverlay key={b.id} block={b} dayYmd={dayYmd} onRemoved={onRefresh} />
                  ))}
                  {appointments
                    .filter((a) => a.clinician.id === clin.id && easternYmdOfIso(a.start_time) === dayYmd)
                    .map((a) => (
                      <DraggableApptCard key={a.id} appt={a} dayYmd={dayYmd} />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {activeDrag ? (
          <ApptCardContent appt={activeDrag} compact={false} className="scale-[1.03] opacity-90 shadow-xl" />
        ) : null}
      </DragOverlay>

      {blockPopover ? (
        <BlockPopoverPanel
          blockPopover={blockPopover}
          blockReason={blockReason}
          setBlockReason={setBlockReason}
          onClose={() => setBlockPopover(null)}
          onSubmit={async () => {
            const p = blockPopover;
            if (!p) return;
            const start = slotStartToUtcIso(p.ymd, p.slotIndex);
            const end = new Date(new Date(start).getTime() + 30 * 60 * 1000).toISOString();
            const h = await authHeaders();
            const res = await fetch(
              `${API_BASE}/clinicians/${encodeURIComponent(p.clinicianId)}/blocked-time`,
              {
                method: "POST",
                headers: h,
                body: JSON.stringify({
                  start_time: start,
                  end_time: end,
                  reason: blockReason.trim() || "Blocked",
                }),
              },
            );
            if (res.ok) {
              setBlockPopover(null);
              setBlockReason("");
              onRefresh();
            }
          }}
        />
      ) : null}
    </DndContext>
  );
}

function DroppableSlotCell({
  id,
  slotIndex,
  isHighlighted,
  onEmptyClick,
}: {
  id: string;
  slotIndex: number;
  isHighlighted: boolean;
  onEmptyClick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onEmptyClick}
      className="absolute right-0 left-0 box-border border-b border-[rgba(0,0,0,0.06)] text-left"
      style={{
        top: slotIndex * ROW_H,
        height: ROW_H,
        background:
          isOver || isHighlighted ? "rgba(22,163,74,0.1)" : undefined,
        borderLeft: isOver ? "2px dashed #16A34A" : undefined,
      }}
    />
  );
}

function DraggableApptCard({
  appt,
  dayYmd,
}: {
  appt: CalendarAppointment;
  dayYmd: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `appt-${appt.id}`,
    data: { appt },
  });
  const dur = appt.treatment_type.duration_minutes || 30;
  const top = (minutesFromGridStart(appt.start_time) / SLOT_MINUTES) * ROW_H;
  const h = (dur / SLOT_MINUTES) * ROW_H;
  const color = appt.clinician.color || "#0EA5A4";
  const style: React.CSSProperties = {
    top,
    height: Math.max(h, ROW_H / 2),
    transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
    zIndex: isDragging ? 50 : 10,
  };

  if (easternYmdOfIso(appt.start_time) !== dayYmd) return null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`absolute right-1 left-1 cursor-grab overflow-hidden rounded-lg bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] active:cursor-grabbing ${
        isDragging ? "scale-[1.03] opacity-90 shadow-lg" : ""
      }`}
      style={{
        ...style,
        borderLeft: `4px solid ${appt.is_new_patient ? "#F59E0B" : color}`,
        background: appt.is_new_patient ? "rgba(245, 158, 11, 0.12)" : `rgba(${hexToRgb(color)}, 0.15)`,
      }}
    >
      <ApptCardContent appt={appt} compact={false} />
    </div>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${r}, ${g}, ${b}`;
}

function ApptCardContent({
  appt,
  compact,
  className = "",
}: {
  appt: CalendarAppointment;
  compact: boolean;
  className?: string;
}) {
  return (
    <div className={`px-2 py-1 ${className}`}>
      <div className="flex items-start justify-between gap-1">
        <p className={`truncate font-semibold text-slate-900 ${compact ? "text-[11px]" : "text-xs"}`}>
          {patientFull(appt)}
        </p>
        <span className={`shrink-0 rounded-full ${statusDotClass(appt.status)} h-2 w-2`} />
      </div>
      <p className={`truncate text-slate-600 ${compact ? "text-[10px]" : "text-[11px]"}`}>
        {appt.treatment_type.name}
      </p>
      {appt.source === "ai" ? (
        <span className="mt-0.5 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
          Aria
        </span>
      ) : null}
    </div>
  );
}

function BlockedOverlay({
  block,
  dayYmd,
  onRemoved,
}: {
  block: BlockedRow;
  dayYmd: string;
  onRemoved: () => void;
}) {
  const dayStart = toDate(`${dayYmd}T${pad2(GRID_START_HOUR)}:00:00`, { timeZone: NY });
  const dayEnd = toDate(`${dayYmd}T${pad2(GRID_END_HOUR)}:00:00`, { timeZone: NY });
  const bs = new Date(block.start_time);
  const be = new Date(block.end_time);
  const clipStart = bs < dayStart ? dayStart : bs;
  const clipEnd = be > dayEnd ? dayEnd : be;
  if (clipEnd <= clipStart) return null;
  const top = ((clipStart.getTime() - dayStart.getTime()) / 60000 / SLOT_MINUTES) * ROW_H;
  const h = ((clipEnd.getTime() - clipStart.getTime()) / 60000 / SLOT_MINUTES) * ROW_H;

  async function remove() {
    const h = await authHeaders();
    await fetch(`${API_BASE}/blocked-time/${encodeURIComponent(block.id)}`, {
      method: "DELETE",
      headers: h,
    });
    onRemoved();
  }

  return (
    <div
      className="pointer-events-auto absolute right-1 left-1 z-20 flex items-start justify-end rounded border border-slate-300 p-0.5"
      style={{
        top: Math.max(0, top),
        height: Math.max(ROW_H / 2, h),
        background:
          "repeating-linear-gradient(45deg, #f1f5f9 25%, transparent 25%, transparent 50%, #f1f5f9 50%, #f1f5f9 75%, transparent 75%, transparent)",
        backgroundSize: "8px 8px",
      }}
    >
      <button
        type="button"
        onClick={() => void remove()}
        className="pointer-events-auto rounded bg-white/90 px-1 text-[10px] text-slate-600 shadow"
      >
        ×
      </button>
    </div>
  );
}

function BlockPopoverPanel({
  blockPopover,
  blockReason,
  setBlockReason,
  onClose,
  onSubmit,
}: {
  blockPopover: { ymd: string; clinicianId: string; slotIndex: number };
  blockReason: string;
  setBlockReason: (s: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
        <p className="text-sm font-medium text-slate-900">Block this time?</p>
        <input
          className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
          placeholder="Reason"
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-white"
            onClick={() => onSubmit()}
          >
            Block
          </button>
        </div>
      </div>
    </div>
  );
}

function WeekGrid({
  weekDays,
  todayYmd,
  appointments,
  onDayHeaderClick,
  onCardClick,
  onDragStart,
  onDragEnd,
  sensors,
  activeDrag,
}: {
  weekDays: string[];
  todayYmd: string;
  appointments: CalendarAppointment[];
  onDayHeaderClick: (ymd: string) => void;
  onCardClick: (a: CalendarAppointment) => void;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  activeDrag: CalendarAppointment | null;
}) {
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((ymd) => {
          const isToday = ymd === todayYmd;
          const dayAppts = appointments
            .filter((a) => easternYmdOfIso(a.start_time) === ymd)
            .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
          return (
            <WeekDayColumn
              key={ymd}
              ymd={ymd}
              isToday={isToday}
              appointments={dayAppts}
              onHeaderClick={() => onDayHeaderClick(ymd)}
              onCardClick={onCardClick}
            />
          );
        })}
      </div>
      <DragOverlay>
        {activeDrag ? (
          <ApptCardContent appt={activeDrag} compact className="scale-[1.03] shadow-lg" />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function WeekDayColumn({
  ymd,
  isToday,
  appointments,
  onHeaderClick,
  onCardClick,
}: {
  ymd: string;
  isToday: boolean;
  appointments: CalendarAppointment[];
  onHeaderClick: () => void;
  onCardClick: (a: CalendarAppointment) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `weekday-${ymd}` });
  const label = formatInTimeZone(new Date(`${ymd}T12:00:00`), NY, "EEE d");
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[280px] rounded-xl border p-2 ${
        isToday ? "border-[#16A34A]/40 bg-green-50/40" : "border-black/10 bg-white"
      } ${isOver ? "ring-2 ring-[#16A34A]/30" : ""}`}
    >
      <button
        type="button"
        onClick={onHeaderClick}
        className="mb-2 w-full text-left text-xs font-semibold text-slate-800 hover:text-[#16A34A]"
      >
        {label}
      </button>
      <div className="space-y-2">
        {appointments.map((a) => (
          <WeekDraggableCard key={a.id} appt={a} onCardClick={onCardClick} />
        ))}
      </div>
    </div>
  );
}

function WeekDraggableCard({
  appt,
  onCardClick,
}: {
  appt: CalendarAppointment;
  onCardClick: (a: CalendarAppointment) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `appt-${appt.id}`,
  });
  const color = appt.clinician.color || "#0EA5A4";
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCardClick(appt);
      }}
      onClick={() => onCardClick(appt)}
      className={`cursor-grab rounded-lg border border-black/10 bg-white p-2 text-left shadow-sm ${
        isDragging ? "scale-[1.03] opacity-90" : ""
      }`}
      style={{
        borderLeft: `3px solid ${color}`,
        transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined,
      }}
    >
      <p className="text-[11px] text-slate-500">
        {formatInTimeZone(new Date(appt.start_time), NY, "h:mm a")}
      </p>
      <div className="flex items-center gap-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <p className="truncate text-xs font-medium text-slate-900">{patientFull(appt)}</p>
      </div>
      <p className="truncate text-[10px] text-slate-500">{appt.treatment_type.name}</p>
    </div>
  );
}

function MonthGrid({
  anchorYmd,
  todayYmd,
  appointments,
  onDayClick,
}: {
  anchorYmd: string;
  todayYmd: string;
  appointments: CalendarAppointment[];
  onDayClick: (ymd: string) => void;
}) {
  const rows = monthCalendarCells(anchorYmd);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarAppointment[]>();
    for (const a of appointments) {
      const d = easternYmdOfIso(a.start_time);
      const list = m.get(d) || [];
      list.push(a);
      m.set(d, list);
    }
    for (const [, list] of m) {
      list.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    }
    return m;
  }, [appointments]);

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="grid grid-cols-7 gap-1">
          {row.map((cell) => {
            const list = byDay.get(cell.ymd) || [];
            const show = list.slice(0, 3);
            const more = list.length - 3;
            const isToday = cell.ymd === todayYmd;
            return (
              <button
                type="button"
                key={cell.ymd}
                onClick={() => onDayClick(cell.ymd)}
                className={`min-h-[100px] rounded-lg border p-1 text-left align-top ${
                  cell.inMonth ? "border-black/10 bg-white" : "border-transparent bg-slate-50 text-slate-400"
                } ${isToday ? "ring-2 ring-[#16A34A]" : ""}`}
              >
                <span className="text-xs font-semibold">{Number(cell.ymd.split("-")[2])}</span>
                <div className="mt-1 space-y-0.5">
                  {show.map((a) => {
                    const c = a.clinician.color || "#0EA5A4";
                    const last = (a.patient.last_name || "").trim() || "?";
                    return (
                      <div
                        key={a.id}
                        className="flex h-5 max-w-full items-center gap-1 overflow-hidden rounded px-1 text-[11px]"
                        style={{
                          background: `rgba(${hexToRgb(c)}, 0.15)`,
                          borderLeft: `3px solid ${c}`,
                        }}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c }} />
                        <span className="truncate">{last}</span>
                      </div>
                    );
                  })}
                  {more > 0 ? (
                    <div className="text-[10px] text-slate-500">+ {more} more</div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

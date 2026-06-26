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
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";

import AppointmentPopup, {
  type AppointmentPopupData,
} from "@/components/calendar/AppointmentPopup";
import GroupSessionDetailModal from "@/components/admin/appointments/GroupSessionDetailModal";
import {
  postCreatePatient,
  type PossibleDuplicateMatch,
} from "@/components/admin/patients/createPatientApi";
import DuplicatePhoneWarning from "@/components/admin/patients/DuplicatePhoneWarning";
import CalendarGroupSessionCard, {
  type CalendarGroupSession,
} from "@/components/scheduling/CalendarGroupSessionCard";
import VirtualVisitButton from "@/components/virtual-visit/VirtualVisitButton";

import {
  addDaysToYmd,
  findMondayYmdOfWeekContaining,
  getEasternYMD,
} from "@/components/adminEastern";
import { injectIntakePrintStylesAndPrint, intakeMedicalHistoryPills, painDotClass } from "@/lib/intakePrint";
import { apiAuthHeaders } from "@/lib/apiAuth";
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
  is_virtual?: boolean;
  is_new_patient?: boolean;
  package_visit_number?: number | null;
  package_total_visits?: number | null;
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
  start_time_of_day?: string | null;
  end_time_of_day?: string | null;
  reason?: string | null;
};

type SlotClickContext = {
  ymd: string;
  clinicianId: string;
  slotIndex: number;
};

type BookingPrefill = {
  date: string;
  time: string;
  clinicianId: string;
  patient?: PatientOption | null;
};

export type CalendarBookPrefill = {
  patient: PatientOption;
  date?: string;
  time?: string;
  clinicianId?: string;
  waitlistEntryId?: string;
};

type ViewMode = "day" | "week" | "month" | "agenda";
export type { ViewMode };
type PatientOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};
type TreatmentTypeOption = {
  id: string;
  name?: string | null;
  duration_minutes?: number | null;
};
type IntakeSummary = {
  id: string;
  appointment_id: string;
  patient_id?: string | null;
  chief_complaint?: string | null;
  pain_scale?: number | null;
  symptom_duration?: string | null;
  aggravating_factors?: string | null;
  relieving_factors?: string | null;
  medical_history_flags?: unknown;
  allergies?: string | null;
  other_conditions?: string | null;
  goals?: string | null;
  created_at?: string | null;
};

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

function blockDateYmd(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || "").trim());
  return match ? match[1] : easternYmdOfIso(iso);
}

function blockCoversDay(block: BlockedRow, dayYmd: string): boolean {
  const startYmd = blockDateYmd(block.start_time);
  const endYmd = blockDateYmd(block.end_time);
  return dayYmd >= startYmd && dayYmd <= endYmd;
}

function isFullDayBlock(block: BlockedRow): boolean {
  return !block.start_time_of_day?.trim() && !block.end_time_of_day?.trim();
}

function slotIndexToHm(slotIndex: number): string {
  const totalMin = GRID_START_HOUR * 60 + slotIndex * SLOT_MINUTES;
  return `${pad2(Math.floor(totalMin / 60))}:${pad2(totalMin % 60)}`;
}

function addMinutesToHm(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

function hmTo12h(hm: string): string {
  const [hRaw, mRaw] = hm.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hm;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${pad2(m)} ${ampm}`;
}

function blockTimeRangeOnDay(
  block: BlockedRow,
  dayYmd: string,
): { start: Date; end: Date } | null {
  if (!blockCoversDay(block, dayYmd)) return null;
  if (isFullDayBlock(block)) {
    return {
      start: toDate(`${dayYmd}T${pad2(GRID_START_HOUR)}:00:00`, { timeZone: NY }),
      end: toDate(`${dayYmd}T${pad2(GRID_END_HOUR)}:00:00`, { timeZone: NY }),
    };
  }
  const startHm = (block.start_time_of_day || "07:00:00").slice(0, 5);
  const endHm = (block.end_time_of_day || "19:00:00").slice(0, 5);
  const [sh, sm] = startHm.split(":").map(Number);
  const [eh, em] = endHm.split(":").map(Number);
  return {
    start: toDate(`${dayYmd}T${pad2(sh)}:${pad2(sm)}:00`, { timeZone: NY }),
    end: toDate(`${dayYmd}T${pad2(eh)}:${pad2(em)}:00`, { timeZone: NY }),
  };
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

function calendarApptToPopupData(a: CalendarAppointment): AppointmentPopupData {
  return {
    id: a.id,
    patient_id: a.patient.id,
    patient_name: patientFull(a),
    patient_phone: a.patient.phone?.trim() || "",
    clinician_name: clinicianLabel(a.clinician),
    appointment_type: a.treatment_type.name?.trim() || "",
    start_time: a.start_time,
    end_time: a.end_time,
    status: a.status,
  };
}

function fetchedAppointmentToCalendar(row: Record<string, unknown>): CalendarAppointment {
  const patientName = String(row.patient_name ?? "").trim();
  const [pFirst, ...pRest] = patientName.split(/\s+/);
  const clinicianName = String(row.clinician_name ?? "").trim();
  const [cFirst, ...cRest] = clinicianName.split(/\s+/);

  return {
    id: String(row.id ?? ""),
    start_time: String(row.start_time ?? ""),
    end_time: String(row.end_time ?? ""),
    status: String(row.status ?? "scheduled"),
    source: "",
    patient: {
      id: String(row.patient_id ?? ""),
      first_name: pFirst || null,
      last_name: pRest.join(" ") || null,
      phone: (row.patient_phone as string | null | undefined) ?? null,
    },
    clinician: {
      id: "",
      first_name: cFirst || null,
      last_name: cRest.join(" ") || null,
      title: null,
      color: null,
    },
    treatment_type: {
      name: (row.appointment_type as string | null | undefined) ?? null,
      duration_minutes: null,
    },
  };
}

function safeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

/** Waits until a bearer token exists (refresh + auth listener) so fetches after navigation are authenticated. */
async function getAccessTokenWithRetry(maxMs = 4000): Promise<string | null> {
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token ?? null;
  if (token) return token;

  await supabase.auth.refreshSession();
  ({ data } = await supabase.auth.getSession());
  token = data.session?.access_token ?? null;
  if (token) return token;

  return new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      void supabase.auth.getSession().then(({ data: d }) => {
        resolve(d.session?.access_token ?? null);
      });
    }, maxMs);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        cleanup();
        resolve(session.access_token);
      }
    });

    function cleanup() {
      clearTimeout(timer);
      subscription.unsubscribe();
    }
  });
}

async function authHeaders(): Promise<Record<string, string>> {
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token ?? "";
  if (!token) {
    await supabase.auth.refreshSession();
    ({ data } = await supabase.auth.getSession());
    token = data.session?.access_token ?? "";
  }
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
  /** When provided, skips fetching clinicians in loadData (parent owns the request). */
  sharedClinicians?: ClinicianRow[];
  /** When provided, skips fetching locations in loadData (parent owns the request). */
  sharedLocations?: LocationRow[];
  openBookingNonce?: number;
  openBlockNonce?: number;
  hideToolbar?: boolean;
  hideCalendarGrid?: boolean;
  view?: ViewMode;
  onViewChange?: (view: ViewMode) => void;
  anchorYmd?: string;
  onAnchorYmdChange?: (ymd: string) => void;
  providerId?: string;
  onProviderIdChange?: (id: string) => void;
  locationId?: string;
  onLocationIdChange?: (id: string) => void;
  openAppointmentId?: string;
  onOpenAppointmentHandled?: () => void;
  bookPrefillNonce?: number;
  bookPrefill?: CalendarBookPrefill | null;
  onBookPrefillConsumed?: () => void;
  onAppointmentBooked?: (info: {
    waitlistEntryId?: string;
  }) => void | Promise<void>;
  /** Increment to re-run loadData (e.g. after group session create). */
  refreshNonce?: number;
};

export default function CalendarView({
  clinicId,
  sharedClinicians,
  sharedLocations,
  openBookingNonce = 0,
  openBlockNonce = 0,
  hideToolbar = false,
  hideCalendarGrid = false,
  view: controlledView,
  onViewChange,
  anchorYmd: controlledAnchorYmd,
  onAnchorYmdChange,
  providerId: controlledProviderId,
  onProviderIdChange,
  locationId: controlledLocationId,
  onLocationIdChange,
  openAppointmentId,
  onOpenAppointmentHandled,
  bookPrefillNonce = 0,
  bookPrefill = null,
  onBookPrefillConsumed,
  onAppointmentBooked,
  refreshNonce = 0,
}: CalendarViewProps) {
  const router = useRouter();
  const [internalView, setInternalView] = useState<ViewMode>("week");
  const [internalAnchorYmd, setInternalAnchorYmd] = useState(() => getEasternYMD(new Date()));
  const [internalProviderId, setInternalProviderId] = useState<string>("");
  const [internalLocationId, setInternalLocationId] = useState<string>("");

  const view = controlledView ?? internalView;
  const setView = useCallback(
    (v: ViewMode) => {
      if (onViewChange) onViewChange(v);
      else setInternalView(v);
    },
    [onViewChange],
  );
  const anchorYmd = controlledAnchorYmd ?? internalAnchorYmd;
  const setAnchorYmd = useCallback(
    (ymd: string | ((prev: string) => string)) => {
      const next = typeof ymd === "function" ? ymd(anchorYmd) : ymd;
      if (onAnchorYmdChange) onAnchorYmdChange(next);
      else setInternalAnchorYmd(next);
    },
    [anchorYmd, onAnchorYmdChange],
  );
  const providerId = controlledProviderId ?? internalProviderId;
  const setProviderId = useCallback(
    (id: string) => {
      if (onProviderIdChange) onProviderIdChange(id);
      else setInternalProviderId(id);
    },
    [onProviderIdChange],
  );
  const locationId = controlledLocationId ?? internalLocationId;
  const setLocationId = useCallback(
    (id: string) => {
      if (onLocationIdChange) onLocationIdChange(id);
      else setInternalLocationId(id);
    },
    [onLocationIdChange],
  );

  const [fetchedClinicians, setFetchedClinicians] = useState<ClinicianRow[]>([]);
  const [fetchedLocations, setFetchedLocations] = useState<LocationRow[]>([]);
  const clinicians = sharedClinicians ?? fetchedClinicians;
  const locations = sharedLocations ?? fetchedLocations;
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [groupSessions, setGroupSessions] = useState<CalendarGroupSession[]>([]);
  const [blocked, setBlocked] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);
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
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [bookingPrefill, setBookingPrefill] = useState<BookingPrefill | null>(null);
  const waitlistEntryIdRef = useRef<string | null>(null);
  const [slotAction, setSlotAction] = useState<SlotClickContext | null>(null);
  const [blockTimeContext, setBlockTimeContext] = useState<SlotClickContext | null>(null);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [detailAppt, setDetailAppt] = useState<CalendarAppointment | null>(null);
  const [popupAppt, setPopupAppt] = useState<CalendarAppointment | null>(null);
  const [popupAnchor, setPopupAnchor] = useState<DOMRect | null>(null);
  const [selectedGroupSessionId, setSelectedGroupSessionId] = useState<string | null>(
    null,
  );
  const [groupSessionDetailOpen, setGroupSessionDetailOpen] = useState(false);
  const [detailIntake, setDetailIntake] = useState<IntakeSummary | null>(null);
  const [detailIntakeLoading, setDetailIntakeLoading] = useState(false);
  const [detailIntakeError, setDetailIntakeError] = useState<string | null>(null);

  const [todayYmd, setTodayYmd] = useState(() => getEasternYMD(new Date()));

  useLayoutEffect(() => {
    if (controlledAnchorYmd !== undefined) return;
    const ymd = getEasternYMD(new Date());
    setInternalAnchorYmd(ymd);
    setTodayYmd(ymd);
  }, [controlledAnchorYmd]);

  const range = useMemo(() => {
    if (view === "day") return { start: anchorYmd, end: anchorYmd };
    if (view === "week" || view === "agenda") {
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

  const filteredGroupSessions = useMemo(() => {
    let list = groupSessions.filter((s) => s.status !== "cancelled");
    if (providerId) list = list.filter((s) => s.clinician_id === providerId);
    if (locationId) list = list.filter((s) => s.location_id === locationId);
    return list;
  }, [groupSessions, providerId, locationId]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setCalendarError(null);
    try {
      const token = await getAccessTokenWithRetry();
      if (!token) {
        setCalendarError("Sign in is required to load the calendar.");
        setAppointments([]);
        setGroupSessions([]);
        if (sharedClinicians === undefined) {
          setFetchedClinicians([]);
        }
        if (sharedLocations === undefined) {
          setFetchedLocations([]);
        }
        setBlocked([]);
        return;
      }

      const h = await authHeaders();
      let calUrl = `${API_BASE}/appointments/calendar?start_date=${encodeURIComponent(range.start)}&end_date=${encodeURIComponent(range.end)}&clinic_id=${encodeURIComponent(clinicId)}`;
      if (providerId) {
        calUrl += `&clinician_id=${encodeURIComponent(providerId)}`;
      }
      let gsUrl = `${API_BASE}/api/group-sessions?clinic_id=${encodeURIComponent(clinicId)}&start_date=${encodeURIComponent(range.start)}&end_date=${encodeURIComponent(range.end)}`;
      if (providerId) {
        gsUrl += `&clinician_id=${encodeURIComponent(providerId)}`;
      }
      if (locationId) {
        gsUrl += `&location_id=${encodeURIComponent(locationId)}`;
      }

      const fetchClinicians = sharedClinicians === undefined;
      const fetchLocations = sharedLocations === undefined;
      const [calRes, gsRes, clinRes, locRes] = await Promise.all([
        fetch(calUrl, { headers: h }),
        fetch(gsUrl, { headers: h }),
        fetchClinicians
          ? fetch(`${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`, {
              headers: h,
            })
          : Promise.resolve(null),
        fetchLocations
          ? supabase
              .from("locations")
              .select("id,name")
              .eq("clinic_id", clinicId)
              .eq("is_active", true)
          : Promise.resolve(null),
      ]);

      if (!calRes.ok) {
        const errBody = (await calRes.json().catch(() => ({}))) as { detail?: string };
        setCalendarError(
          errBody.detail?.trim() ||
            `Could not load appointments (${calRes.status}). Try again.`,
        );
        setAppointments([]);
        setBlocked([]);
      } else {
        const calJson = await calRes.json();
        setAppointments(Array.isArray(calJson.appointments) ? calJson.appointments : []);
      }

      if (gsRes.ok) {
        const gsJson = await gsRes.json();
        setGroupSessions(Array.isArray(gsJson) ? (gsJson as CalendarGroupSession[]) : []);
      } else {
        setGroupSessions([]);
      }

      let clinJson: ClinicianRow[] = sharedClinicians ?? [];
      if (fetchClinicians && clinRes) {
        clinJson = clinRes.ok ? await clinRes.json() : [];
        setFetchedClinicians(Array.isArray(clinJson) ? clinJson : []);
      }
      if (fetchLocations && locRes) {
        setFetchedLocations((locRes.data as LocationRow[]) || []);
      }

      if (!calRes.ok) {
        return;
      }

      if (view === "day") {
        const clinicianRows = fetchClinicians ? clinJson : clinicians;
        const ids = providerId
          ? [providerId]
          : clinicianRows.map((c) => c.id);
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
      setCalendarError("Something went wrong loading the calendar. Check your connection and try again.");
      setAppointments([]);
      setGroupSessions([]);
      setBlocked([]);
    } finally {
      setLoading(false);
    }
  }, [
    clinicId,
    range.start,
    range.end,
    view,
    anchorYmd,
    providerId,
    locationId,
    sharedClinicians,
    sharedLocations,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (refreshNonce <= 0) return;
    void loadData();
  }, [refreshNonce, loadData]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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
    if (view === "week" || view === "agenda") {
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
    else if (view === "week" || view === "agenda") setAnchorYmd((y) => addDaysToYmd(y, -7));
    else {
      const [yy, mm] = anchorYmd.split("-").map(Number);
      const d = new Date(yy, mm - 2, 1);
      setAnchorYmd(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`);
    }
  }

  function navigateNext() {
    if (view === "day") setAnchorYmd((y) => addDaysToYmd(y, 1));
    else if (view === "week" || view === "agenda") setAnchorYmd((y) => addDaysToYmd(y, 7));
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
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(err.detail || "Failed to update appointment time");
    }
    await loadData();
  }

  const closeAppointmentPopup = useCallback(() => {
    setPopupAppt(null);
    setPopupAnchor(null);
  }, []);

  const handleApptCardClick = useCallback(
    (appt: CalendarAppointment, anchorRect: DOMRect) => {
      setDetailAppt(appt);
      setPopupAppt(appt);
      setPopupAnchor(anchorRect);
    },
    [],
  );

  const handleGroupSessionClick = useCallback((session: CalendarGroupSession) => {
    setSelectedGroupSessionId(session.id);
    setGroupSessionDetailOpen(true);
  }, []);

  const closeGroupSessionDetail = useCallback(() => {
    setGroupSessionDetailOpen(false);
    setSelectedGroupSessionId(null);
  }, []);

  async function patchAppointmentStatus(
    id: string,
    status: "checked_in" | "completed" | "cancelled",
  ) {
    const h = await authHeaders();
    const res = await fetch(
      `${API_BASE}/appointments/${encodeURIComponent(id)}/status`,
      {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ status }),
      },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(err.detail || "Failed to update appointment status");
    }
  }

  const handlePopupCheckIn = useCallback(
    async (id: string) => {
      try {
        await patchAppointmentStatus(id, "checked_in");
        closeAppointmentPopup();
        await loadData();
        setToast({ kind: "success", message: "Patient checked in" });
      } catch (e) {
        setToast({
          kind: "error",
          message: e instanceof Error ? e.message : "Check-in failed",
        });
      }
    },
    [closeAppointmentPopup, loadData],
  );

  const handlePopupCheckOut = useCallback(
    async (id: string) => {
      try {
        await patchAppointmentStatus(id, "completed");
        closeAppointmentPopup();
        await loadData();
        setToast({ kind: "success", message: "Patient checked out" });
      } catch (e) {
        setToast({
          kind: "error",
          message: e instanceof Error ? e.message : "Check-out failed",
        });
      }
    },
    [closeAppointmentPopup, loadData],
  );

  const handlePopupRescheduleConfirm = useCallback(
    async (id: string, startTimeIso: string) => {
      try {
        await patchAppointmentTime(id, startTimeIso);
        closeAppointmentPopup();
        await loadData();
        setToast({ kind: "success", message: "Appointment rescheduled" });
      } catch (e) {
        setToast({
          kind: "error",
          message: e instanceof Error ? e.message : "Reschedule failed",
        });
        throw e;
      }
    },
    [closeAppointmentPopup, loadData],
  );

  const handlePopupCancel = useCallback(
    async (id: string) => {
      try {
        await patchAppointmentStatus(id, "cancelled");
        closeAppointmentPopup();
        await loadData();
        setToast({ kind: "success", message: "Appointment cancelled" });
      } catch (e) {
        setToast({
          kind: "error",
          message: e instanceof Error ? e.message : "Cancel failed",
        });
        throw e;
      }
    },
    [closeAppointmentPopup, loadData],
  );

  const handlePopupScheduleFollowUp = useCallback(
    (patientId: string, patientName: string) => {
      const calAppt = appointments.find((a) => a.patient.id === patientId);
      closeAppointmentPopup();
      const nameParts = patientName.trim().split(/\s+/);
      const first = nameParts[0] ?? "";
      const last = nameParts.slice(1).join(" ");
      setBookingPrefill({
        date: getEasternYMD(new Date()),
        time: "09:00",
        clinicianId: calAppt?.clinician.id || clinicians[0]?.id || "",
        patient: calAppt
          ? {
              id: calAppt.patient.id,
              first_name: calAppt.patient.first_name,
              last_name: calAppt.patient.last_name,
              phone: calAppt.patient.phone,
            }
          : { id: patientId, first_name: first, last_name: last },
      });
      setBookModalOpen(true);
    },
    [appointments, clinicians, closeAppointmentPopup],
  );

  const handlePopupOpenChart = useCallback(
    (patientId: string) => {
      closeAppointmentPopup();
      router.push(`/admin/patients/${patientId}`);
    },
    [closeAppointmentPopup, router],
  );

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

  const activeLocationId = useMemo(() => {
    if (locationId) return locationId;
    return locations[0]?.id ?? "";
  }, [locationId, locations]);

  const intakePrintReady =
    detailAppt != null &&
    !detailIntakeLoading &&
    !detailIntakeError &&
    detailIntake != null;

  useEffect(() => {
    if (!openAppointmentId || openAppointmentId.startsWith("block-")) return;

    const openPopup = (appt: CalendarAppointment) => {
      setDetailAppt(appt);
      setPopupAppt(appt);
      setPopupAnchor(new DOMRect(window.innerWidth / 2, 160, 0, 0));
      onOpenAppointmentHandled?.();
    };

    const local = appointments.find((a) => a.id === openAppointmentId);
    if (local) {
      openPopup(local);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/appointments/${encodeURIComponent(openAppointmentId)}?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        if (cancelled) return;
        if (!res.ok) {
          console.error(
            "Failed to load appointment for openAppointmentId",
            openAppointmentId,
            res.status,
          );
          onOpenAppointmentHandled?.();
          return;
        }
        const row = (await res.json()) as Record<string, unknown>;
        if (cancelled) return;
        openPopup(fetchedAppointmentToCalendar(row));
      } catch (e) {
        console.error(
          "Failed to load appointment for openAppointmentId",
          openAppointmentId,
          e,
        );
        onOpenAppointmentHandled?.();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openAppointmentId, appointments, onOpenAppointmentHandled, clinicId]);

  useEffect(() => {
    if (!detailAppt?.id) return;
    const fresh = appointments.find((a) => a.id === detailAppt.id);
    if (fresh) {
      setDetailAppt(fresh);
    }
  }, [appointments, detailAppt?.id]);

  useEffect(() => {
    if (openBookingNonce <= 0) return;
    waitlistEntryIdRef.current = null;
    setBookModalOpen(true);
  }, [openBookingNonce]);

  useEffect(() => {
    if (bookPrefillNonce <= 0 || !bookPrefill) return;
    setBookingPrefill({
      date: bookPrefill.date || getEasternYMD(new Date()),
      time: bookPrefill.time || "09:00",
      clinicianId: bookPrefill.clinicianId || "",
      patient: bookPrefill.patient,
    });
    waitlistEntryIdRef.current = bookPrefill.waitlistEntryId ?? null;
    setBookModalOpen(true);
    onBookPrefillConsumed?.();
  }, [bookPrefillNonce, bookPrefill, onBookPrefillConsumed]);

  useEffect(() => {
    if (openBlockNonce <= 0) return;
    const ymd = anchorYmd || getEasternYMD(new Date());
    const clinicianId = providerId || clinicians[0]?.id || "";
    if (!clinicianId) return;
    setBlockTimeContext({
      ymd,
      clinicianId,
      slotIndex: 0,
    });
  }, [openBlockNonce, anchorYmd, providerId, clinicians]);

  useEffect(() => {
    return () => {
      setBookModalOpen(false);
    };
  }, []);

  useEffect(() => {
    if (!detailAppt?.id) {
      setDetailIntake(null);
      setDetailIntakeLoading(false);
      setDetailIntakeError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailIntakeLoading(true);
      setDetailIntakeError(null);
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/intake/${encodeURIComponent(detailAppt.id)}`,
          { headers: h },
        );
        const json = (await res.json().catch(() => ({}))) as {
          intake?: IntakeSummary | null;
          detail?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(json.detail || "Could not load intake");
        }
        setDetailIntake(json.intake ?? null);
      } catch (e) {
        if (cancelled) return;
        setDetailIntake(null);
        setDetailIntakeError(
          e instanceof Error ? e.message : "Could not load intake",
        );
      } finally {
        if (!cancelled) setDetailIntakeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailAppt?.id]);

  return (
    <div className={hideToolbar ? "space-y-2" : "space-y-4"}>
      {!hideToolbar ? (
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
      ) : null}

      {!hideCalendarGrid && undo ? (
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

      {!hideCalendarGrid && (loading ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white p-10 text-center">
          <span
            className="inline-block size-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#16A34A]"
            aria-hidden
          />
          <p className="text-sm font-medium text-slate-700">Loading calendar…</p>
          <p className="max-w-sm text-xs text-slate-500">
            Fetching appointments for {periodLabel}.
          </p>
        </div>
      ) : calendarError ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 rounded-xl border border-red-200 bg-red-50/80 p-10 text-center">
          <p className="text-sm font-medium text-red-900">{calendarError}</p>
          <button
            type="button"
            className="rounded-lg bg-[#16A34A] px-4 py-2 text-sm font-medium text-white hover:bg-[#15803D]"
            onClick={() => void loadData()}
          >
            Retry
          </button>
        </div>
      ) : filteredAppointments.length === 0 && appointments.length > 0 ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-10 text-center">
          <p className="text-sm font-medium text-slate-800">No appointments match your filters</p>
          <p className="max-w-xs text-xs text-slate-600">
            Clear the provider or location filter to see all appointments in this date range.
          </p>
        </div>
      ) : view === "day" ? (
        <DayGrid
          dayYmd={anchorYmd}
          todayYmd={todayYmd}
          clinicians={activeClinicians}
          appointments={filteredAppointments}
          groupSessions={filteredGroupSessions}
          blocked={blocked}
          onRefresh={() => void loadData()}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          sensors={sensors}
          activeDrag={activeDrag}
          onSlotClick={setSlotAction}
          onApptClick={handleApptCardClick}
          onGroupSessionClick={handleGroupSessionClick}
        />
      ) : view === "week" ? (
        <WeekGrid
          weekDays={weekDays}
          todayYmd={todayYmd}
          appointments={filteredAppointments}
          groupSessions={filteredGroupSessions}
          defaultClinicianId={providerId || activeClinicians[0]?.id || ""}
          onDayHeaderClick={(ymd) => {
            setAnchorYmd(ymd);
            setView("day");
          }}
          onCardClick={handleApptCardClick}
          onGroupSessionClick={handleGroupSessionClick}
          onSlotClick={(ctx) => {
            setBookingPrefill({
              date: ctx.ymd,
              time: slotIndexToHm(ctx.slotIndex),
              clinicianId: ctx.clinicianId,
            });
            setBookModalOpen(true);
          }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          sensors={sensors}
          activeDrag={activeDrag}
        />
      ) : view === "agenda" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="space-y-2">
            {[...filteredAppointments]
              .sort(
                (a, b) =>
                  Date.parse(a.start_time) - Date.parse(b.start_time),
              )
              .map((appt) => (
                <button
                  key={appt.id}
                  type="button"
                  onClick={(e) => handleApptCardClick(appt, e.currentTarget.getBoundingClientRect())}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-100 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {patientFull(appt)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {appt.treatment_type.name ?? "Visit"} ·{" "}
                      {formatInTimeZone(
                        toDate(appt.start_time),
                        NY,
                        "EEE MMM d · h:mm a",
                      )}
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-700">
                    {(appt.status ?? "scheduled").replace(/_/g, " ")}
                  </span>
                </button>
              ))}
            {filteredAppointments.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                No appointments in this range.
              </p>
            ) : null}
          </div>
        </div>
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
      ))}

      {slotAction ? (
        <SlotActionMenu
          context={slotAction}
          onClose={() => setSlotAction(null)}
          onNewAppointment={(ctx) => {
            setBookingPrefill({
              date: ctx.ymd,
              time: slotIndexToHm(ctx.slotIndex),
              clinicianId: ctx.clinicianId,
            });
            setSlotAction(null);
            setBookModalOpen(true);
          }}
          onBlockTime={(ctx) => {
            setSlotAction(null);
            setBlockTimeContext(ctx);
          }}
        />
      ) : null}

      {blockTimeContext ? (
        <BlockTimeModal
          context={blockTimeContext}
          onClose={() => setBlockTimeContext(null)}
          onSaved={async () => {
            setBlockTimeContext(null);
            setToast({ kind: "success", message: "Time blocked" });
            await loadData();
          }}
          onError={(message) => setToast({ kind: "error", message })}
        />
      ) : null}

      {popupAppt && popupAnchor ? (
        <AppointmentPopup
          appointment={calendarApptToPopupData(popupAppt)}
          anchorRect={popupAnchor}
          clinicId={clinicId}
          onClose={closeAppointmentPopup}
          onCheckIn={(id) => void handlePopupCheckIn(id)}
          onCheckOut={(id) => void handlePopupCheckOut(id)}
          onRescheduleConfirm={handlePopupRescheduleConfirm}
          onCancelAppointment={handlePopupCancel}
          onScheduleFollowUp={handlePopupScheduleFollowUp}
          onOpenChart={handlePopupOpenChart}
        />
      ) : null}

      <GroupSessionDetailModal
        sessionId={selectedGroupSessionId}
        open={groupSessionDetailOpen}
        onClose={closeGroupSessionDetail}
        onUpdated={() => void loadData()}
      />

      {bookModalOpen ? (
        <BookPatientModal
          clinicId={clinicId}
          clinicians={clinicians}
          locationId={activeLocationId}
          initialDate={bookingPrefill?.date}
          initialTime={bookingPrefill?.time}
          initialClinicianId={bookingPrefill?.clinicianId}
          initialPatient={bookingPrefill?.patient}
          onClose={() => {
            setBookModalOpen(false);
            setBookingPrefill(null);
            waitlistEntryIdRef.current = null;
          }}
          onBooked={async () => {
            const waitlistEntryId = waitlistEntryIdRef.current ?? undefined;
            setBookModalOpen(false);
            setBookingPrefill(null);
            waitlistEntryIdRef.current = null;
            setToast({ kind: "success", message: "Appointment booked" });
            if (onAppointmentBooked) {
              await onAppointmentBooked({ waitlistEntryId });
            }
            await loadData();
          }}
          onError={(message) => {
            setToast({ kind: "error", message });
          }}
        />
      ) : null}

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
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
            <div
              id={intakePrintReady ? "intake-print-area" : undefined}
            >
              {intakePrintReady ? (
                <div className="intake-print-print-only hidden text-center text-base font-semibold text-slate-900">
                  Straight To The Point Dry Needling
                </div>
              ) : null}
              <p className="font-semibold text-slate-900">{patientFull(detailAppt)}</p>
              <p className="mt-1 text-sm text-slate-600">
                {(() => {
                  const d = safeDate(detailAppt.start_time);
                  const timeStr = d ? formatInTimeZone(d, NY, "h:mm a") : "Invalid time";
                  return (
                    <>
                      <span className="intake-print-field-value intake-print-meta-line">
                        {timeStr}
                      </span>
                      <span className="intake-print-screen-extra">
                        {" "}
                        · {detailAppt.treatment_type.name}
                      </span>
                    </>
                  );
                })()}
              </p>
              <p className="mt-1 text-xs text-slate-500 intake-print-screen-extra">
                {clinicianLabel({
                  id: detailAppt.clinician.id,
                  first_name: detailAppt.clinician.first_name,
                  last_name: detailAppt.clinician.last_name,
                  title: detailAppt.clinician.title,
                })}
              </p>
              {detailIntakeLoading ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Loading pre-visit intake summary…
                </div>
              ) : detailIntakeError ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  Could not load intake summary.
                </div>
              ) : detailIntake == null ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No intake form on file for this appointment
                </div>
              ) : (
                <section className="mt-4 rounded-lg border border-slate-200 bg-white">
                  <header className="flex items-center justify-between gap-3 border-l-4 border-[#16A34A] bg-slate-50 px-4 py-3">
                    <h3 className="intake-print-doc-title text-sm font-semibold text-slate-900">
                      Pre-Visit Intake Summary
                    </h3>
                    <button
                      type="button"
                      className="intake-print-toolbar-btn inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#16A34A] px-2.5 py-1 text-xs font-medium text-[#16A34A] hover:bg-green-50"
                      onClick={() => injectIntakePrintStylesAndPrint("intake-print-area")}
                    >
                      <Printer className="size-3.5" aria-hidden />
                      Download PDF
                    </button>
                  </header>
                  <div className="space-y-3 px-4 py-4">
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Chief Complaint
                      </p>
                      <p className="intake-print-field-value mt-1 text-sm font-semibold text-slate-900">
                        {detailIntake.chief_complaint?.trim() || "Not provided"}
                      </p>
                    </div>
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Pain Scale
                      </p>
                      <div className="intake-print-field-value mt-1 flex items-center gap-2 text-sm text-slate-900">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${painDotClass(detailIntake.pain_scale)}`}
                          aria-hidden
                        />
                        <span>
                          {detailIntake.pain_scale != null
                            ? `${detailIntake.pain_scale} / 10`
                            : "Not provided"}
                        </span>
                      </div>
                    </div>
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Symptom Duration
                      </p>
                      <p className="intake-print-field-value mt-1 text-sm text-slate-900">
                        {detailIntake.symptom_duration?.trim() || "Not provided"}
                      </p>
                    </div>
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Aggravating Factors
                      </p>
                      <p className="intake-print-field-value mt-1 text-sm text-slate-900">
                        {detailIntake.aggravating_factors?.trim() || "Not provided"}
                      </p>
                    </div>
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Relieving Factors
                      </p>
                      <p className="intake-print-field-value mt-1 text-sm text-slate-900">
                        {detailIntake.relieving_factors?.trim() || "Not provided"}
                      </p>
                    </div>
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Medical History Flags
                      </p>
                      <div className="intake-print-field-value mt-1 flex flex-wrap gap-2">
                        {(() => {
                          const pills = intakeMedicalHistoryPills(
                            detailIntake.medical_history_flags,
                          );
                          if (!pills.length) {
                            return (
                              <span className="text-sm text-slate-500">
                                None reported
                              </span>
                            );
                          }
                          return pills.map((pill, idx) => (
                            <span
                              key={`${pill}-${idx}`}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                            >
                              {pill}
                            </span>
                          ));
                        })()}
                      </div>
                    </div>
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Allergies
                      </p>
                      <p className="intake-print-field-value mt-1 text-sm text-slate-900">
                        {detailIntake.allergies?.trim() || "Not provided"}
                      </p>
                    </div>
                    <div className="intake-print-field-row">
                      <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-slate-500">
                        Goals
                      </p>
                      <p className="intake-print-field-value mt-1 text-sm text-slate-900">
                        {detailIntake.goals?.trim() || "Not provided"}
                      </p>
                    </div>
                  </div>
                  <footer className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
                    {(() => {
                      const submitted = safeDate(detailIntake.created_at);
                      if (!submitted) return "Submitted —";
                      return `Submitted ${submitted.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}`;
                    })()}
                  </footer>
                </section>
              )}
              {intakePrintReady ? (
                <div className="intake-print-print-only intake-print-confidential-footer hidden text-center text-xs text-slate-600">
                  Confidential — Clinical Use Only
                </div>
              ) : null}
            </div>
            <section className="mt-4 border-t border-slate-100 pt-4">
              <button
                type="button"
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={() => {
                  const params = new URLSearchParams({
                    appointment_id: detailAppt.id,
                    patient_id: detailAppt.patient.id,
                  });
                  setDetailAppt(null);
                  router.push(`/admin/clinical-notes?${params.toString()}`);
                }}
              >
                <span aria-hidden>📋</span>
                Open Clinical Note
              </button>
            </section>
            <section className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-[#0d9488] focus:ring-[#0d9488]"
                  checked={detailAppt.is_virtual === true}
                  onChange={(e) => {
                    const next = e.target.checked;
                    void (async () => {
                      try {
                        const h = await authHeaders();
                        const res = await fetch(
                          `${API_BASE}/appointments/${encodeURIComponent(detailAppt.id)}/virtual?clinic_id=${encodeURIComponent(clinicId)}`,
                          {
                            method: "PATCH",
                            headers: h,
                            body: JSON.stringify({ is_virtual: next }),
                          },
                        );
                        if (!res.ok) {
                          setToast({
                            kind: "error",
                            message: "Could not update virtual visit setting",
                          });
                          return;
                        }
                        setDetailAppt((prev) =>
                          prev ? { ...prev, is_virtual: next } : prev,
                        );
                        void loadData();
                      } catch {
                        setToast({
                          kind: "error",
                          message: "Could not update virtual visit setting",
                        });
                      }
                    })();
                  }}
                />
                Virtual Visit
              </label>
              <VirtualVisitButton
                appointment={{
                  id: detailAppt.id,
                  patient_id: detailAppt.patient.id,
                  clinician_id: detailAppt.clinician.id,
                  clinic_id: clinicId,
                  patient_name: patientFull(detailAppt),
                  patient_phone: detailAppt.patient.phone ?? "",
                  clinician_name:
                    `${detailAppt.clinician.first_name ?? ""} ${detailAppt.clinician.last_name ?? ""}`.trim(),
                  is_virtual: detailAppt.is_virtual,
                }}
                onSuccess={(message) =>
                  setToast({ kind: "success", message })
                }
                onError={(message) => setToast({ kind: "error", message })}
              />
            </section>
            <button
              type="button"
              className="intake-print-close-btn mt-4 w-full rounded-lg border border-black/10 py-2 text-sm"
              onClick={() => {
                setDetailAppt(null);
                closeAppointmentPopup();
              }}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className={`fixed right-4 bottom-4 z-[70] rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${
            toast.kind === "success" ? "bg-[#16A34A]" : "bg-[#DC2626]"
          }`}
        >
          {toast.message}
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
  groupSessions,
  blocked,
  onRefresh,
  onDragStart,
  onDragEnd,
  sensors,
  activeDrag,
  onSlotClick,
  onApptClick,
  onGroupSessionClick,
}: {
  dayYmd: string;
  todayYmd: string;
  clinicians: ClinicianRow[];
  appointments: CalendarAppointment[];
  groupSessions: CalendarGroupSession[];
  blocked: BlockedRow[];
  onRefresh: () => void;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  activeDrag: CalendarAppointment | null;
  onSlotClick: (ctx: SlotClickContext) => void;
  onApptClick: (appt: CalendarAppointment, anchorRect: DOMRect) => void;
  onGroupSessionClick: (session: CalendarGroupSession) => void;
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
      if (!blockCoversDay(b, dayYmd)) continue;
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
            style={{ paddingTop: 40 }}
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
                      onEmptyClick={() =>
                        onSlotClick({ ymd: dayYmd, clinicianId: clin.id, slotIndex })
                      }
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
                      <DraggableApptCard
                        key={a.id}
                        appt={a}
                        dayYmd={dayYmd}
                        onApptClick={onApptClick}
                      />
                    ))}
                  {groupSessions
                    .filter(
                      (s) =>
                        s.clinician_id === clin.id &&
                        easternYmdOfIso(s.start_time) === dayYmd,
                    )
                    .map((s) => (
                      <CalendarGroupSessionCard
                        key={`gs-${s.id}`}
                        session={s}
                        variant="day"
                        dayYmd={dayYmd}
                        onClick={onGroupSessionClick}
                      />
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
  onEmptyClick?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const hasClick = typeof onEmptyClick === "function";
  return (
    <div
      ref={setNodeRef}
      onClick={onEmptyClick}
      className={`absolute right-0 left-0 box-border border-b border-[rgba(0,0,0,0.06)] text-left ${
        hasClick ? "cursor-pointer" : "cursor-default"
      }`}
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
  onApptClick,
}: {
  appt: CalendarAppointment;
  dayYmd: string;
  onApptClick?: (appt: CalendarAppointment, anchorRect: DOMRect) => void;
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
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onApptClick?.(appt, (e.currentTarget as HTMLElement).getBoundingClientRect());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onApptClick?.(appt, (e.currentTarget as HTMLElement).getBoundingClientRect());
        }
      }}
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
      {appt.package_visit_number != null && appt.package_total_visits != null ? (
        <span className="mt-0.5 inline-block rounded-full bg-[#EFF6FF] px-1.5 py-0.5 text-xs text-[#1D4ED8]">
          Visit {appt.package_visit_number} of {appt.package_total_visits}
        </span>
      ) : null}
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
  const range = blockTimeRangeOnDay(block, dayYmd);
  if (!range) return null;

  const dayStart = toDate(`${dayYmd}T${pad2(GRID_START_HOUR)}:00:00`, { timeZone: NY });
  const dayEnd = toDate(`${dayYmd}T${pad2(GRID_END_HOUR)}:00:00`, { timeZone: NY });
  const clipStart = range.start < dayStart ? dayStart : range.start;
  const clipEnd = range.end > dayEnd ? dayEnd : range.end;
  if (clipEnd <= clipStart) return null;

  const top = ((clipStart.getTime() - dayStart.getTime()) / 60000 / SLOT_MINUTES) * ROW_H;
  const h = ((clipEnd.getTime() - clipStart.getTime()) / 60000 / SLOT_MINUTES) * ROW_H;
  const fullDay = isFullDayBlock(block);
  const label =
    block.reason?.trim() ||
    (fullDay ? "Blocked" : "Blocked");

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
      className={`pointer-events-auto absolute right-1 left-1 z-20 flex flex-col justify-between rounded border p-1 ${
        fullDay
          ? "border-slate-300"
          : "border-slate-400 bg-slate-300/55"
      }`}
      style={{
        top: Math.max(0, top),
        height: Math.max(ROW_H / 2, h),
        background: fullDay
          ? "repeating-linear-gradient(45deg, #f1f5f9 25%, transparent 25%, transparent 50%, #f1f5f9 50%, #f1f5f9 75%, transparent 75%, transparent)"
          : undefined,
        backgroundSize: fullDay ? "8px 8px" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-1 px-0.5">
        <span className="truncate text-[10px] font-medium text-slate-700">{label}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void remove();
          }}
          className="pointer-events-auto shrink-0 rounded bg-white/90 px-1 text-[10px] text-slate-600 shadow"
        >
          ×
        </button>
      </div>
      {!fullDay && block.start_time_of_day && block.end_time_of_day ? (
        <span className="px-0.5 text-[9px] text-slate-600">
          {hmTo12h(block.start_time_of_day.slice(0, 5))}–
          {hmTo12h(block.end_time_of_day.slice(0, 5))}
        </span>
      ) : null}
    </div>
  );
}

function SlotActionMenu({
  context,
  onClose,
  onNewAppointment,
  onBlockTime,
}: {
  context: SlotClickContext;
  onClose: () => void;
  onNewAppointment: (ctx: SlotClickContext) => void;
  onBlockTime: (ctx: SlotClickContext) => void;
}) {
  const timeLabel = hmTo12h(slotIndexToHm(context.slotIndex));
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${context.ymd}T12:00:00`));

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-xs rounded-xl bg-white p-4 shadow-xl">
        <p className="text-sm font-semibold text-slate-900">Schedule action</p>
        <p className="mt-1 text-xs text-slate-500">
          {dateLabel} · {timeLabel}
        </p>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            className="w-full rounded-lg bg-[#16A34A] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#15803D]"
            onClick={() => onNewAppointment(context)}
          >
            New Appointment
          </button>
          <button
            type="button"
            className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
            onClick={() => onBlockTime(context)}
          >
            Block Time
          </button>
          <button
            type="button"
            className="w-full rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockTimeModal({
  context,
  onClose,
  onSaved,
  onError,
}: {
  context: SlotClickContext;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const startHm = slotIndexToHm(context.slotIndex);
  const [endTime, setEndTime] = useState(() => addMinutesToHm(startHm, 60));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${context.ymd}T12:00:00`));

  async function saveBlock() {
    if (!endTime || endTime <= startHm) {
      onError("End time must be after start time.");
      return;
    }
    setSaving(true);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API_BASE}/availability/blocked-time`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          clinician_id: context.clinicianId,
          start_date: context.ymd,
          end_date: context.ymd,
          start_time_of_day: startHm,
          end_time_of_day: endTime,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        onError(
          typeof json?.detail === "string" ? json.detail : `Failed to block time (${res.status})`,
        );
        return;
      }
      await onSaved();
    } catch {
      onError("Could not save block.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Block Time</h3>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
            <input
              type="text"
              readOnly
              className="h-9 w-full rounded-lg border border-gray-200 bg-slate-50 px-3 text-sm text-slate-700"
              value={dateLabel}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Start time</label>
              <input
                type="text"
                readOnly
                className="h-9 w-full rounded-lg border border-gray-200 bg-slate-50 px-3 text-sm text-slate-700"
                value={hmTo12h(startHm)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">End time</label>
              <input
                type="time"
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Reason (optional)</label>
            <input
              type="text"
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
              placeholder="e.g. Lunch, Meeting, Personal"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-black/10 px-4 py-2 text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-[#16A34A] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            onClick={() => void saveBlock()}
          >
            {saving ? "Saving…" : "Save Block"}
          </button>
        </div>
      </div>
    </div>
  );
}

const BookPatientModal = memo(function BookPatientModal({
  clinicId,
  clinicians,
  locationId,
  initialDate,
  initialTime,
  initialClinicianId,
  initialPatient,
  onClose,
  onBooked,
  onError,
}: {
  clinicId: string;
  clinicians: ClinicianRow[];
  locationId: string;
  initialDate?: string;
  initialTime?: string;
  initialClinicianId?: string;
  initialPatient?: PatientOption | null;
  onClose: () => void;
  onBooked: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [results, setResults] = useState<PatientOption[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [newPatient, setNewPatient] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    date_of_birth: "",
  });
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<
    PossibleDuplicateMatch[] | null
  >(null);
  const [treatmentTypes, setTreatmentTypes] = useState<TreatmentTypeOption[]>([]);
  const [loadingTreatmentTypes, setLoadingTreatmentTypes] = useState(false);
  const [treatmentTypeId, setTreatmentTypeId] = useState("");
  const [selectedDate, setSelectedDate] = useState(
    () => initialDate || getEasternYMD(new Date()),
  );
  const [selectedTime, setSelectedTime] = useState(initialTime || "09:00");
  const [selectedClinicianId, setSelectedClinicianId] = useState(
    () => initialClinicianId || clinicians[0]?.id || "",
  );
  const [modalClinicians, setModalClinicians] = useState<ClinicianRow[]>(clinicians);
  const [isVirtual, setIsVirtual] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate);
    if (initialTime) setSelectedTime(initialTime);
    if (initialClinicianId) setSelectedClinicianId(initialClinicianId);
  }, [initialDate, initialTime, initialClinicianId]);

  useEffect(() => {
    if (initialPatient) {
      setSelectedPatient(initialPatient);
      setStep(2);
    }
  }, [initialPatient]);

  useEffect(() => {
    setModalClinicians(clinicians);
  }, [clinicians]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await apiAuthHeaders();
        const res = await fetch(
          `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers },
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) {
          setModalClinicians(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setModalClinicians(clinicians);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId, clinicians]);

  useEffect(() => {
    if (treatmentTypes.length > 0 && !treatmentTypeId) {
      setTreatmentTypeId(treatmentTypes[0].id);
    }
  }, [treatmentTypes, treatmentTypeId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTreatmentTypes(true);
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/treatment-types?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setTreatmentTypes(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setTreatmentTypes([]);
      } finally {
        if (!cancelled) setLoadingTreatmentTypes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedClinicianId && modalClinicians.length > 0) {
      setSelectedClinicianId(modalClinicians[0].id);
    }
  }, [modalClinicians, selectedClinicianId]);

  useEffect(() => {
    let cancelled = false;
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      (async () => {
        setSearchLoading(true);
        try {
          const h = await authHeaders();
          const res = await fetch(
            `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(search.trim())}`,
            { headers: h },
          );
          const json = res.ok ? await res.json() : [];
          if (!cancelled) setResults(Array.isArray(json) ? json : []);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [clinicId, search]);

  function buildNewPatientBody(): Record<string, string> {
    return {
      clinic_id: clinicId,
      first_name: newPatient.first_name.trim(),
      last_name: newPatient.last_name.trim(),
      phone: newPatient.phone.trim(),
      date_of_birth: newPatient.date_of_birth.trim(),
    };
  }

  function selectExistingPatient(match: PossibleDuplicateMatch) {
    setSelectedPatient({
      id: match.id,
      first_name: match.first_name,
      last_name: match.last_name,
      phone: newPatient.phone.trim(),
    });
    setShowNewPatient(false);
    setDuplicateMatches(null);
    setStep(2);
  }

  async function continueWithNewPatient(confirmDuplicate = false) {
    if (
      !newPatient.first_name.trim() ||
      !newPatient.last_name.trim() ||
      !newPatient.phone.trim() ||
      !newPatient.date_of_birth.trim()
    ) {
      onError("Please complete all new patient fields.");
      return;
    }
    setCreatingPatient(true);
    if (!confirmDuplicate) {
      setDuplicateMatches(null);
    }
    try {
      const result = await postCreatePatient(buildNewPatientBody(), confirmDuplicate);
      if (result.kind === "possible_duplicate") {
        setDuplicateMatches(result.matches);
        return;
      }
      if (result.kind === "error") {
        onError(result.message);
        return;
      }
      setSelectedPatient(result.patient as PatientOption);
      setShowNewPatient(false);
      setDuplicateMatches(null);
      setStep(2);
    } catch {
      onError("Could not create patient.");
    } finally {
      setCreatingPatient(false);
    }
  }

  async function confirmBooking() {
    if (!selectedPatient?.id) {
      onError("Select a patient first.");
      return;
    }
    if (!treatmentTypeId) {
      onError("Select a treatment type.");
      return;
    }
    if (!selectedClinicianId) {
      onError("Select a clinician.");
      return;
    }
    if (!locationId) {
      onError("Select a location before booking.");
      return;
    }

    const dateStr = selectedDate;
    const timeStr = selectedTime;
    const [year, month, day] = dateStr.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      onError("Invalid date or time selected. Please check your inputs.");
      return;
    }

    // Accept either "HH:MM" or "h:MM AM/PM" from the picker.
    let hours = 0;
    let minutes = 0;
    if (timeStr.includes(" ")) {
      const [timePart, periodRaw] = timeStr.split(" ");
      const [hoursStr, minutesStr] = timePart.split(":");
      hours = parseInt(hoursStr, 10);
      minutes = parseInt(minutesStr, 10);
      const period = (periodRaw || "").toUpperCase();
      if (period === "PM" && hours !== 12) hours += 12;
      if (period === "AM" && hours === 12) hours = 0;
    } else {
      const [hoursStr, minutesStr] = timeStr.split(":");
      hours = parseInt(hoursStr, 10);
      minutes = parseInt(minutesStr, 10);
    }

    if (
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      onError("Invalid date or time selected. Please check your inputs.");
      return;
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    const localISO = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00`;
    const easternOffsetHours = 4; // EDT
    const utcDate = new Date(`${localISO}-0${easternOffsetHours}:00`);
    if (Number.isNaN(utcDate.getTime())) {
      onError("Invalid date or time selected. Please check your inputs.");
      return;
    }
    const start_time = utcDate.toISOString();

    setConfirming(true);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API_BASE}/appointments`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          clinician_id: selectedClinicianId,
          clinic_id: clinicId,
          location_id: locationId,
          treatment_type_id: treatmentTypeId,
          start_time,
          source: "manual",
          is_virtual: isVirtual,
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        onError(msg || `Error ${res.status}`);
        return;
      }
      await onBooked();
    } catch {
      onError("Could not book appointment.");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Book Patient</h3>
          <button
            type="button"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {step === 1 ? (
          <div className="space-y-3">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Search patient by name or phone
            </label>
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Start typing..."
            />
            <div className="max-h-48 overflow-auto rounded-lg border border-gray-100">
              {searchLoading ? (
                <div className="p-3 text-sm text-slate-500">Searching…</div>
              ) : results.length === 0 ? (
                <div className="p-3 text-sm text-slate-500">No matches yet.</div>
              ) : (
                results.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center justify-between border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-green-50 last:border-b-0"
                    onClick={() => {
                      setSelectedPatient(p);
                      setShowNewPatient(false);
                      setStep(2);
                    }}
                  >
                    <span>{`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Patient"}</span>
                    <span className="text-xs text-slate-500">{p.phone || "—"}</span>
                  </button>
                ))
              )}
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm font-medium text-[#16A34A] hover:bg-green-50"
                onClick={() => {
                  setShowNewPatient(true);
                  setDuplicateMatches(null);
                }}
              >
                + New Patient
              </button>
            </div>

            {showNewPatient ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="First Name"
                  value={newPatient.first_name}
                  onChange={(e) =>
                    setNewPatient((p) => ({ ...p, first_name: e.target.value }))
                  }
                />
                <input
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Last Name"
                  value={newPatient.last_name}
                  onChange={(e) =>
                    setNewPatient((p) => ({ ...p, last_name: e.target.value }))
                  }
                />
                <input
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Phone"
                  value={newPatient.phone}
                  onChange={(e) =>
                    setNewPatient((p) => ({ ...p, phone: e.target.value }))
                  }
                />
                <input
                  type="date"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  value={newPatient.date_of_birth}
                  onChange={(e) =>
                    setNewPatient((p) => ({ ...p, date_of_birth: e.target.value }))
                  }
                />
                {duplicateMatches?.length ? (
                  <div className="sm:col-span-2">
                    <DuplicatePhoneWarning
                      matches={duplicateMatches}
                      busy={creatingPatient}
                      allowSelectExisting
                      onSelectExisting={selectExistingPatient}
                      onCreateAnyway={() => void continueWithNewPatient(true)}
                    />
                  </div>
                ) : null}
                {!duplicateMatches?.length ? (
                <div className="sm:col-span-2 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-black/10 px-3 py-2 text-sm"
                    onClick={() => {
                      setShowNewPatient(false);
                      setDuplicateMatches(null);
                    }}
                    disabled={creatingPatient}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-[#16A34A] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    onClick={() => void continueWithNewPatient(false)}
                    disabled={creatingPatient}
                  >
                    {creatingPatient ? "Creating…" : "Continue"}
                  </button>
                </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="Patient" value={`${selectedPatient?.first_name ?? ""} ${selectedPatient?.last_name ?? ""}`.trim()} />
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Clinician
                </label>
                <select
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                  value={selectedClinicianId}
                  onChange={(e) => setSelectedClinicianId(e.target.value)}
                >
                  {modalClinicians.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`Dr. ${(c.first_name ?? "").trim()} ${(c.last_name ?? "").trim()}`.trim()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Date
                </label>
                <input
                  type="date"
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Time
                </label>
                <select
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                >
                  {Array.from({ length: 24 }, (_, i) => i).flatMap((h) =>
                    [0, 30].map((m) => `${pad2(h)}:${pad2(m)}`),
                  )
                    .filter((s) => s >= "07:00" && s <= "19:00")
                    .map((s) => (
                      <option key={s} value={s}>
                        {(() => {
                          try {
                            const optionDate = toDate(`${selectedDate}T${s}:00`, { timeZone: NY });
                            if (Number.isNaN(optionDate.getTime())) return s;
                            return formatInTimeZone(optionDate, NY, "h:mm a");
                          } catch {
                            return s;
                          }
                        })()}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Treatment Type
                </label>
                <select
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
                  value={treatmentTypeId}
                  onChange={(e) => setTreatmentTypeId(e.target.value)}
                  disabled={loadingTreatmentTypes}
                >
                  {treatmentTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name || t.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-[#0d9488] focus:ring-[#0d9488]"
                checked={isVirtual}
                onChange={(e) => setIsVirtual(e.target.checked)}
              />
              Virtual Visit
            </label>
            <div className="flex flex-wrap justify-between gap-2">
              <button
                type="button"
                className="rounded-lg border border-black/10 px-4 py-2 text-sm"
                onClick={() => setStep(1)}
              >
                Back
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-black/10 px-4 py-2 text-sm"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[#16A34A] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  onClick={() => void confirmBooking()}
                  disabled={confirming}
                >
                  {confirming ? "Booking…" : "Confirm Booking"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-slate-800">
        {value || "—"}
      </div>
    </div>
  );
}

function WeekGrid({
  weekDays,
  todayYmd,
  appointments,
  groupSessions,
  defaultClinicianId,
  onDayHeaderClick,
  onCardClick,
  onGroupSessionClick,
  onSlotClick,
  onDragStart,
  onDragEnd,
  sensors,
  activeDrag,
}: {
  weekDays: string[];
  todayYmd: string;
  appointments: CalendarAppointment[];
  groupSessions: CalendarGroupSession[];
  defaultClinicianId: string;
  onDayHeaderClick: (ymd: string) => void;
  onCardClick: (a: CalendarAppointment, anchorRect: DOMRect) => void;
  onGroupSessionClick: (session: CalendarGroupSession) => void;
  onSlotClick: (ctx: SlotClickContext) => void;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  activeDrag: CalendarAppointment | null;
}) {
  const gridHeight = NUM_SLOTS * ROW_H;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="flex min-w-max">
          <div
            className="sticky left-0 z-20 w-16 shrink-0 border-r border-black/10 bg-white"
            style={{ paddingTop: 40 }}
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
          {weekDays.map((ymd) => {
            const isToday = ymd === todayYmd;
            const dayAppts = appointments.filter(
              (a) => easternYmdOfIso(a.start_time) === ymd,
            );
            const dayGroupSessions = groupSessions.filter(
              (s) => easternYmdOfIso(s.start_time) === ymd,
            );
            return (
              <WeekDayColumn
                key={ymd}
                ymd={ymd}
                isToday={isToday}
                todayYmd={todayYmd}
                gridHeight={gridHeight}
                defaultClinicianId={defaultClinicianId}
                appointments={dayAppts}
                groupSessions={dayGroupSessions}
                onHeaderClick={() => onDayHeaderClick(ymd)}
                onApptClick={onCardClick}
                onGroupSessionClick={onGroupSessionClick}
                onSlotClick={onSlotClick}
              />
            );
          })}
        </div>
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
  todayYmd,
  gridHeight,
  defaultClinicianId,
  appointments,
  groupSessions,
  onHeaderClick,
  onApptClick,
  onGroupSessionClick,
  onSlotClick,
}: {
  ymd: string;
  isToday: boolean;
  todayYmd: string;
  gridHeight: number;
  defaultClinicianId: string;
  appointments: CalendarAppointment[];
  groupSessions: CalendarGroupSession[];
  onHeaderClick: () => void;
  onApptClick: (a: CalendarAppointment, anchorRect: DOMRect) => void;
  onGroupSessionClick: (session: CalendarGroupSession) => void;
  onSlotClick: (ctx: SlotClickContext) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `weekday-${ymd}` });
  const label = formatInTimeZone(new Date(`${ymd}T12:00:00`), NY, "EEE d");
  const nowLinePx = useMemo(() => {
    if (ymd !== todayYmd) return null;
    const now = new Date();
    const mins = minutesFromGridStart(now.toISOString());
    if (mins < 0 || mins > NUM_SLOTS * SLOT_MINUTES) return null;
    return (mins / SLOT_MINUTES) * ROW_H;
  }, [ymd, todayYmd]);

  return (
    <div
      ref={setNodeRef}
      className={`relative flex-1 min-w-[132px] shrink-0 border-r border-black/10 ${
        isToday ? "bg-green-50/30" : "bg-white"
      } ${isOver ? "ring-2 ring-[#16A34A]/20" : ""}`}
    >
      <button
        type="button"
        onClick={onHeaderClick}
        className={`sticky top-0 z-10 w-full border-b border-black/10 px-1.5 py-2 text-left text-[11px] font-semibold hover:text-[#16A34A] ${
          isToday ? "bg-green-50/80 text-[#16A34A]" : "bg-white text-slate-800"
        }`}
      >
        {label}
      </button>
      <div className="relative" style={{ height: gridHeight }}>
        {Array.from({ length: NUM_SLOTS }, (_, slotIndex) => (
          <DroppableSlotCell
            key={slotIndex}
            id={`slot|${ymd}|${defaultClinicianId}|${slotIndex}`}
            slotIndex={slotIndex}
            isHighlighted={false}
            onEmptyClick={() =>
              onSlotClick({ ymd, clinicianId: defaultClinicianId, slotIndex })
            }
          />
        ))}
        {nowLinePx !== null ? (
          <div
            className="pointer-events-none absolute right-0 left-0 z-30 border-t-2 border-red-500"
            style={{ top: nowLinePx }}
          />
        ) : null}
        {appointments.map((a) => (
          <DraggableApptCard
            key={a.id}
            appt={a}
            dayYmd={ymd}
            onApptClick={onApptClick}
          />
        ))}
        {groupSessions.map((s) => (
          <CalendarGroupSessionCard
            key={`gs-${s.id}`}
            session={s}
            variant="day"
            dayYmd={ymd}
            onClick={onGroupSessionClick}
          />
        ))}
      </div>
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
      list.sort((a, b) => {
        const at = safeDate(a.start_time)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bt = safeDate(b.start_time)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return at - bt;
      });
    }
    return m;
  }, [appointments]);

  return (
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <h2 className="mb-4 text-xl font-semibold text-slate-900">
        {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
          (() => {
            const [y, m] = anchorYmd.split("-").map(Number);
            return new Date(y, m - 1, 1);
          })(),
        )}
      </h2>
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

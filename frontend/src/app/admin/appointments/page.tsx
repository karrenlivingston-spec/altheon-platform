"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
} from "lucide-react";

import {
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import AppointmentsDaySchedule from "@/components/admin/appointments/AppointmentsDaySchedule";
import AppointmentsSidePanels from "@/components/admin/appointments/AppointmentsSidePanels";
import AppointmentsStatCards from "@/components/admin/appointments/AppointmentsStatCards";
import AppointmentsWeekStrip from "@/components/admin/appointments/AppointmentsWeekStrip";
import {
  AppointmentStats,
  AppointmentTasks,
  AriaStats,
  ClinicianUtilization,
  DayListItem,
  UpcomingItem,
} from "@/components/admin/appointments/appointmentsTypes";
import {
  addDaysToYmd,
  findMondayYmdOfWeekContaining,
  getEasternYMD,
} from "@/components/adminEastern";
import CalendarView, {
  type CalendarBookPrefill,
  type ViewMode,
} from "@/components/scheduling/CalendarView";
import PatientFlow from "@/components/scheduling/PatientFlow";
import NewPatientModal from "@/components/admin/patients/NewPatientModal";
import AddToWaitlistModal from "@/components/admin/appointments/AddToWaitlistModal";
import WaitlistViewModal, {
  type WaitlistBookRequest,
} from "@/components/admin/appointments/WaitlistViewModal";
import GroupSessionModal from "@/components/admin/appointments/GroupSessionModal";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type ClinicianOption = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
};

type LocationOption = { id: string; name?: string };

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function clinicianLabel(c: ClinicianOption): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return c.title ? `${n}, ${c.title}` : n || "Provider";
}

function formatDayTitle(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminAppointmentsPage() {
  const { clinicId } = useClinic();
  const [view, setView] = useState<ViewMode>("day");
  const [anchorYmd, setAnchorYmd] = useState(() => getEasternYMD(new Date()));
  const [providerId, setProviderId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);

  const [stats, setStats] = useState<AppointmentStats | null>(null);
  const [tasks, setTasks] = useState<AppointmentTasks | null>(null);
  const [utilization, setUtilization] = useState<ClinicianUtilization[]>([]);
  const [aria, setAria] = useState<AriaStats | null>(null);
  const [dayList, setDayList] = useState<DayListItem[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [weekItems, setWeekItems] = useState<Record<string, DayListItem[]>>({});
  const [dashLoading, setDashLoading] = useState(true);

  const [openBookingNonce, setOpenBookingNonce] = useState(0);
  const [openBlockNonce, setOpenBlockNonce] = useState(0);
  const [openAppointmentId, setOpenAppointmentId] = useState<string | undefined>();
  const [patientFlowOpen, setPatientFlowOpen] = useState(false);
  const [newApptMenuOpen, setNewApptMenuOpen] = useState(false);
  const [newPatientModalOpen, setNewPatientModalOpen] = useState(false);
  const [addWaitlistOpen, setAddWaitlistOpen] = useState(false);
  const [waitlistViewOpen, setWaitlistViewOpen] = useState(false);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [bookPrefillNonce, setBookPrefillNonce] = useState(0);
  const [bookPrefill, setBookPrefill] = useState<CalendarBookPrefill | null>(
    null,
  );
  const [groupSessionModalOpen, setGroupSessionModalOpen] = useState(false);
  const [groupSessionCreatedMsg, setGroupSessionCreatedMsg] = useState<
    string | null
  >(null);
  const [calendarRefreshNonce, setCalendarRefreshNonce] = useState(0);

  const weekMonday = useMemo(
    () => findMondayYmdOfWeekContaining(anchorYmd),
    [anchorYmd],
  );

  const loadMeta = useCallback(async () => {
    const h = await authHeaders();
    const [clinRes, locRes] = await Promise.all([
      fetch(`${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`, {
        headers: h,
      }),
      supabase
        .from("locations")
        .select("id,name")
        .eq("clinic_id", clinicId)
        .eq("is_active", true),
    ]);
    setClinicians(clinRes.ok ? await clinRes.json() : []);
    setLocations((locRes.data as LocationOption[]) ?? []);
  }, [clinicId]);

  const loadWaitlistCount = useCallback(async () => {
    if (!clinicId) return;
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/api/waitlist?clinic_id=${encodeURIComponent(clinicId)}&status=waiting`,
        { headers: h },
      );
      const json = res.ok ? await res.json() : [];
      setWaitlistCount(Array.isArray(json) ? json.length : 0);
    } catch {
      setWaitlistCount(0);
    }
  }, [clinicId]);

  const loadDashboard = useCallback(async () => {
    if (!clinicId) return;
    setDashLoading(true);
    try {
      const h = await authHeaders();
      const params = new URLSearchParams({
        clinic_id: clinicId,
        date: anchorYmd,
      });
      const dayParams = new URLSearchParams({
        clinic_id: clinicId,
        date: anchorYmd,
      });
      if (providerId) dayParams.set("clinician_id", providerId);

      const weekDays = Array.from({ length: 7 }, (_, i) =>
        addDaysToYmd(weekMonday, i),
      );

      const [
        statsRes,
        tasksRes,
        utilRes,
        ariaRes,
        dayRes,
        upcomingRes,
        ...weekResList
      ] = await Promise.all([
        fetch(`${API_BASE}/api/appointments/stats?${params}`, { headers: h }),
        fetch(`${API_BASE}/api/appointments/tasks?clinic_id=${encodeURIComponent(clinicId)}`, {
          headers: h,
        }),
        fetch(`${API_BASE}/api/appointments/utilization?${params}`, { headers: h }),
        fetch(`${API_BASE}/api/appointments/aria-stats?${params}`, { headers: h }),
        fetch(`${API_BASE}/api/appointments/day-list?${dayParams}`, { headers: h }),
        fetch(
          `${API_BASE}/api/appointments/upcoming?clinic_id=${encodeURIComponent(clinicId)}&limit=4`,
          { headers: h },
        ),
        ...weekDays.map((d) =>
          fetch(
            `${API_BASE}/api/appointments/day-list?clinic_id=${encodeURIComponent(clinicId)}&date=${d}${providerId ? `&clinician_id=${encodeURIComponent(providerId)}` : ""}`,
            { headers: h },
          ),
        ),
      ]);

      setStats(statsRes.ok ? await statsRes.json() : null);
      setTasks(tasksRes.ok ? await tasksRes.json() : null);
      setUtilization(utilRes.ok ? await utilRes.json() : []);
      setAria(ariaRes.ok ? await ariaRes.json() : null);
      setDayList(dayRes.ok ? await dayRes.json() : []);
      setUpcoming(upcomingRes.ok ? await upcomingRes.json() : []);

      const weekMap: Record<string, DayListItem[]> = {};
      await Promise.all(
        weekResList.map(async (res, i) => {
          weekMap[weekDays[i]] = res.ok ? await res.json() : [];
        }),
      );
      setWeekItems(weekMap);
    } finally {
      setDashLoading(false);
    }
  }, [clinicId, anchorYmd, providerId, weekMonday]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    void loadWaitlistCount();
  }, [loadWaitlistCount]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  function handleWaitlistBookNow(request: WaitlistBookRequest) {
    setWaitlistViewOpen(false);
    setBookPrefill({
      patient: request.patient,
      date: request.date,
      time: request.time,
      clinicianId: request.clinicianId,
      waitlistEntryId: request.waitlistEntryId,
    });
    setBookPrefillNonce((n) => n + 1);
  }

  async function handleAppointmentBooked(info: { waitlistEntryId?: string }) {
    if (!info.waitlistEntryId) return;
    try {
      const h = await authHeaders();
      await fetch(
        `${API_BASE}/api/waitlist/${encodeURIComponent(info.waitlistEntryId)}`,
        {
          method: "PATCH",
          headers: { ...h, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "booked" }),
        },
      );
      await loadWaitlistCount();
    } catch {
      // Appointment still booked; waitlist status update is best-effort.
    }
  }

  function goToday() {
    setAnchorYmd(getEasternYMD(new Date()));
  }

  function navigatePrev() {
    if (view === "day") setAnchorYmd((y) => addDaysToYmd(y, -1));
    else if (view === "week" || view === "agenda")
      setAnchorYmd((y) => addDaysToYmd(y, -7));
    else {
      const [yy, mm] = anchorYmd.split("-").map(Number);
      const d = new Date(yy, mm - 2, 1);
      setAnchorYmd(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      );
    }
  }

  function navigateNext() {
    if (view === "day") setAnchorYmd((y) => addDaysToYmd(y, 1));
    else if (view === "week" || view === "agenda")
      setAnchorYmd((y) => addDaysToYmd(y, 7));
    else {
      const [yy, mm] = anchorYmd.split("-").map(Number);
      const d = new Date(yy, mm, 1);
      setAnchorYmd(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      );
    }
  }

  const viewPill = (v: ViewMode, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={
        view === v
          ? "rounded-full bg-[#16A34A] px-3 py-1.5 text-sm font-medium text-white"
          : "rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
      }
    >
      {label}
    </button>
  );

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Appointments</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Scheduling, provider utilization and patient flow
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${DS_SECONDARY_BTN} relative`}
            onClick={() => setWaitlistViewOpen(true)}
          >
            Waitlist
            {waitlistCount > 0 ? (
              <span className="ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-emerald-600 px-1.5 py-0.5 text-xs font-medium text-white">
                {waitlistCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            onClick={() => setPatientFlowOpen((v) => !v)}
          >
            Patient Flow
          </button>
          <div className="relative">
            <button
              type="button"
              className={`${DS_PRIMARY_BTN} inline-flex items-center gap-1`}
              onClick={() => {
                setOpenBookingNonce((n) => n + 1);
                setNewApptMenuOpen(false);
              }}
            >
              <Plus className="h-4 w-4" />
              New Appointment
              <ChevronDown
                className="h-4 w-4"
                onClick={(e) => {
                  e.stopPropagation();
                  setNewApptMenuOpen((v) => !v);
                }}
              />
            </button>
            {newApptMenuOpen ? (
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  onClick={() => {
                    setOpenBookingNonce((n) => n + 1);
                    setNewApptMenuOpen(false);
                  }}
                >
                  Book appointment
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  onClick={() => {
                    setOpenBlockNonce((n) => n + 1);
                    setNewApptMenuOpen(false);
                  }}
                >
                  Block time
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            onClick={() => setOpenBookingNonce((n) => n + 1)}
          >
            + Appointment
          </button>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            onClick={() => setOpenBlockNonce((n) => n + 1)}
          >
            + Block Time
          </button>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            onClick={() => setNewPatientModalOpen(true)}
          >
            + New Patient
          </button>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            onClick={() => setAddWaitlistOpen(true)}
          >
            + Waitlist
          </button>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            onClick={() => setGroupSessionModalOpen(true)}
          >
            + Group Session
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className={`${DS_INPUT} h-10 min-w-[160px]`}
          >
            <option value="">All Providers</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>
                {clinicianLabel(c)}
              </option>
            ))}
          </select>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={`${DS_INPUT} h-10 min-w-[140px]`}
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || l.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
            aria-label="Filters"
          >
            <Filter className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={navigatePrev}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={navigateNext}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="flex flex-wrap gap-1">
            {viewPill("day", "Day")}
            {viewPill("week", "Week")}
            {viewPill("month", "Month")}
            {viewPill("agenda", "Agenda")}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <AppointmentsStatCards stats={stats} loading={dashLoading} />
      </div>

      {patientFlowOpen ? (
        <section className="mt-6">
          <PatientFlow />
        </section>
      ) : null}

      <div className="mt-6 flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 xl:w-[65%]">
          {view === "day" ? (
            <>
              <AppointmentsDaySchedule
                items={dayList}
                loading={dashLoading}
                dateLabel={formatDayTitle(anchorYmd)}
                onView={(id) => setOpenAppointmentId(id)}
                onEdit={(id) => setOpenAppointmentId(id)}
              />
              <AppointmentsWeekStrip
                anchorYmd={anchorYmd}
                weekItems={weekItems}
                loading={dashLoading}
                onDayClick={setAnchorYmd}
                onViewFullCalendar={() => setView("week")}
              />
            </>
          ) : null}

          <CalendarView
            clinicId={clinicId}
            openBookingNonce={openBookingNonce}
            openBlockNonce={openBlockNonce}
            hideToolbar
            hideCalendarGrid={view === "day"}
            view={view}
            onViewChange={setView}
            anchorYmd={anchorYmd}
            onAnchorYmdChange={setAnchorYmd}
            providerId={providerId}
            onProviderIdChange={setProviderId}
            locationId={locationId}
            onLocationIdChange={setLocationId}
            openAppointmentId={openAppointmentId}
            onOpenAppointmentHandled={() => setOpenAppointmentId(undefined)}
            bookPrefillNonce={bookPrefillNonce}
            bookPrefill={bookPrefill}
            onBookPrefillConsumed={() => setBookPrefill(null)}
            onAppointmentBooked={handleAppointmentBooked}
            refreshNonce={calendarRefreshNonce}
          />
        </div>

        <div className="w-full shrink-0 xl:w-[35%]">
          <AppointmentsSidePanels
            tasks={tasks}
            utilization={utilization}
            aria={aria}
            upcoming={upcoming}
            loading={dashLoading}
          />
        </div>
      </div>

      {groupSessionCreatedMsg ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          {groupSessionCreatedMsg}
        </div>
      ) : null}

      <NewPatientModal
        open={newPatientModalOpen}
        onClose={() => setNewPatientModalOpen(false)}
        onCreated={() => setNewPatientModalOpen(false)}
      />

      <AddToWaitlistModal
        open={addWaitlistOpen}
        onClose={() => setAddWaitlistOpen(false)}
        onAdded={() => void loadWaitlistCount()}
      />

      <WaitlistViewModal
        open={waitlistViewOpen}
        onClose={() => setWaitlistViewOpen(false)}
        onBookNow={handleWaitlistBookNow}
        onChanged={() => void loadWaitlistCount()}
      />

      <GroupSessionModal
        open={groupSessionModalOpen}
        onClose={() => setGroupSessionModalOpen(false)}
        onCreated={() => {
          setGroupSessionCreatedMsg("Group session created");
          setCalendarRefreshNonce((n) => n + 1);
          window.setTimeout(() => setGroupSessionCreatedMsg(null), 4000);
        }}
      />
    </div>
  );
}

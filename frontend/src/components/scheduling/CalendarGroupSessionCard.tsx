"use client";

import { formatInTimeZone } from "date-fns-tz";

const NY = "America/New_York";
const ROW_H = 60;
const GRID_START_HOUR = 7;
const SLOT_MINUTES = 30;

const GROUP_ACCENT = "#7C3AED";

export type CalendarGroupSession = {
  id: string;
  clinic_id: string;
  clinician_id: string;
  location_id: string;
  treatment_type_id: string;
  title?: string | null;
  start_time: string;
  end_time: string;
  capacity: number;
  status: string;
  notes?: string | null;
  attendee_count: number;
  clinician_first_name?: string | null;
  clinician_last_name?: string | null;
  treatment_type_name?: string | null;
};

export function groupSessionLabel(session: CalendarGroupSession): string {
  const title =
    (session.title || "").trim() ||
    (session.treatment_type_name || "").trim() ||
    "Group Session";
  const count = session.attendee_count ?? 0;
  const cap = session.capacity ?? 0;
  return `${title} — ${count}/${cap} patients`;
}

function minutesFromGridStart(iso: string): number {
  const h = Number(formatInTimeZone(new Date(iso), NY, "H"));
  const m = Number(formatInTimeZone(new Date(iso), NY, "m"));
  return h * 60 + m - GRID_START_HOUR * 60;
}

function durationMinutes(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const mins = (end.getTime() - start.getTime()) / 60000;
  return Number.isFinite(mins) && mins > 0 ? mins : SLOT_MINUTES;
}

function easternYmdOfIso(iso: string): string {
  return formatInTimeZone(new Date(iso), NY, "yyyy-MM-dd");
}

type CalendarGroupSessionCardProps = {
  session: CalendarGroupSession;
  variant: "day" | "week";
  dayYmd?: string;
  onClick: (session: CalendarGroupSession) => void;
};

export default function CalendarGroupSessionCard({
  session,
  variant,
  dayYmd,
  onClick,
}: CalendarGroupSessionCardProps) {
  const label = groupSessionLabel(session);

  if (variant === "day") {
    if (!dayYmd || easternYmdOfIso(session.start_time) !== dayYmd) return null;
    const top = (minutesFromGridStart(session.start_time) / SLOT_MINUTES) * ROW_H;
    const dur = durationMinutes(session.start_time, session.end_time);
    const h = (dur / SLOT_MINUTES) * ROW_H;

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(session);
        }}
        className="absolute right-1 left-1 z-[11] cursor-pointer overflow-hidden rounded-lg border border-violet-200 bg-violet-50/90 text-left shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:bg-violet-100/90"
        style={{
          top,
          height: Math.max(h, ROW_H / 2),
          borderLeft: `4px solid ${GROUP_ACCENT}`,
        }}
      >
        <div className="px-2 py-1">
          <p className="truncate text-xs font-semibold text-violet-950">{label}</p>
          <p className="truncate text-[10px] text-violet-700">Group session</p>
        </div>
      </button>
    );
  }

  const startDate = new Date(session.start_time);
  if (Number.isNaN(startDate.getTime())) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(session);
      }}
      className="w-full cursor-pointer rounded-lg border border-violet-200 bg-violet-50/90 p-2 text-left shadow-sm hover:bg-violet-100/90"
      style={{ borderLeft: `3px solid ${GROUP_ACCENT}` }}
    >
      <p className="text-[11px] text-violet-700">
        {formatInTimeZone(startDate, NY, "h:mm a")}
      </p>
      <p className="truncate text-xs font-medium text-violet-950">{label}</p>
      <p className="truncate text-[10px] text-violet-600">Group session</p>
    </button>
  );
}

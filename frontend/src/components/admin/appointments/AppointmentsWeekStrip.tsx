"use client";

import { DS_CARD } from "@/app/admin/designSystem";
import { DayListItem } from "@/components/admin/appointments/appointmentsTypes";
import {
  addDaysToYmd,
  findMondayYmdOfWeekContaining,
} from "@/components/adminEastern";

type AppointmentsWeekStripProps = {
  anchorYmd: string;
  weekItems: Record<string, DayListItem[]>;
  loading?: boolean;
  onDayClick: (ymd: string) => void;
  onViewFullCalendar: () => void;
};

function formatWeekRange(mondayYmd: string): string {
  const sun = addDaysToYmd(mondayYmd, 6);
  const monD = new Date(`${mondayYmd}T12:00:00`);
  const sunD = new Date(`${sun}T12:00:00`);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  return `Week of ${fmt.format(monD)} – ${fmt.format(sunD)}`;
}

export default function AppointmentsWeekStrip({
  anchorYmd,
  weekItems,
  loading,
  onDayClick,
  onViewFullCalendar,
}: AppointmentsWeekStripProps) {
  const monday = findMondayYmdOfWeekContaining(anchorYmd);
  const days = Array.from({ length: 7 }, (_, i) => addDaysToYmd(monday, i));

  return (
    <div className={`${DS_CARD} mt-4`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {formatWeekRange(monday)}
        </h3>
        <button
          type="button"
          onClick={onViewFullCalendar}
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          View Full Calendar →
        </button>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-gray-500">Loading week…</p>
      ) : (
        <div className="mt-4 grid grid-cols-7 gap-2 overflow-x-auto">
          {days.map((ymd) => {
            const d = new Date(`${ymd}T12:00:00`);
            const label = d.toLocaleDateString("en-US", { weekday: "short" });
            const dayNum = d.getDate();
            const items = weekItems[ymd] ?? [];
            const isSelected = ymd === anchorYmd;
            return (
              <button
                key={ymd}
                type="button"
                onClick={() => onDayClick(ymd)}
                className={`min-w-[100px] rounded-lg border p-2 text-left ${
                  isSelected
                    ? "border-emerald-400 bg-emerald-50/50"
                    : "border-gray-200 bg-gray-50/50 hover:border-gray-300"
                }`}
              >
                <p className="text-xs font-semibold text-gray-700">
                  {label} {dayNum}
                </p>
                <div className="mt-2 space-y-1">
                  {items.slice(0, 3).map((item) => (
                    <div
                      key={item.id}
                      className="truncate rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-700 shadow-sm"
                      title={`${item.start_time} ${item.patient_name}`}
                    >
                      {item.is_blocked
                        ? "Blocked"
                        : `${item.start_time} ${item.patient_name.split(" ")[0]}`}
                    </div>
                  ))}
                  {items.length > 3 ? (
                    <p className="text-[10px] text-gray-400">+{items.length - 3} more</p>
                  ) : null}
                  {items.length === 0 ? (
                    <p className="text-[10px] text-gray-400">—</p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

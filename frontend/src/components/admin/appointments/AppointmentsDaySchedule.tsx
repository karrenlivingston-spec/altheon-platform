"use client";

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  DayListItem,
  statusLabel,
  statusStyle,
} from "@/components/admin/appointments/appointmentsTypes";

type AppointmentsDayScheduleProps = {
  items: DayListItem[];
  loading?: boolean;
  dateLabel: string;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
};

export default function AppointmentsDaySchedule({
  items,
  loading,
  dateLabel,
  onView,
  onEdit,
}: AppointmentsDayScheduleProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuId) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuId]);

  return (
    <div className={DS_CARD}>
      <h3 className="text-sm font-semibold text-gray-900">{dateLabel}</h3>
      {loading ? (
        <p className="mt-6 py-12 text-center text-sm text-gray-500">Loading schedule…</p>
      ) : items.length === 0 ? (
        <p className="mt-6 py-12 text-center text-sm text-gray-500">
          No appointments scheduled for this day.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => {
            const st = statusStyle(item.status);
            return (
              <div
                key={item.id}
                className={`group relative flex gap-4 rounded-lg border border-gray-100 border-l-4 bg-white px-4 py-3 transition-colors hover:bg-gray-50 ${st.border}`}
              >
                <div className="w-20 shrink-0 pt-0.5">
                  <p className="text-sm font-semibold text-gray-900">{item.start_time}</p>
                  <p className="text-xs text-gray-400">{item.end_time}</p>
                </div>
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: item.clinician_color ?? "#16a34a" }}
                >
                  {item.is_blocked ? "—" : item.patient_avatar_initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">
                    {item.is_blocked ? "Blocked" : item.patient_name}
                  </p>
                  {!item.is_blocked ? (
                    <>
                      <p className="text-sm text-gray-600">
                        {item.treatment_type}
                        {item.visit_subtype ? ` · ${item.visit_subtype}` : ""}
                      </p>
                      <p className="text-xs text-gray-400">{item.clinician_name}</p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">{item.visit_subtype || "Unavailable"}</p>
                  )}
                  {item.tags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                    {statusLabel(item.status)}
                  </span>
                  {!item.is_blocked ? (
                    <button
                      type="button"
                      onClick={() => setMenuId(menuId === item.id ? null : item.id)}
                      className="rounded-lg p-1 text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100"
                      aria-label="Actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                {menuId === item.id ? (
                  <div
                    ref={menuRef}
                    className="absolute right-4 top-12 z-20 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        setMenuId(null);
                        onView(item.id);
                      }}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        setMenuId(null);
                        onEdit(item.id);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

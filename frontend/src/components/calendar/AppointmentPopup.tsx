"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatInTimeZone, toDate } from "date-fns-tz";

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const NY = "America/New_York";

export type AppointmentPopupData = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_phone: string;
  clinician_name: string;
  appointment_type: string;
  start_time: string;
  end_time: string;
  status: string;
  insurance_carrier?: string;
  diagnosis_code?: string;
};

type Props = {
  appointment: AppointmentPopupData;
  anchorRect: DOMRect;
  clinicId: string;
  readOnly?: boolean;
  onClose: () => void;
  onCheckIn: (id: string) => void;
  onCheckOut: (id: string) => void;
  onRescheduleConfirm: (id: string, startTimeIso: string) => Promise<void>;
  onCancelAppointment: (id: string) => Promise<void>;
  onScheduleFollowUp: (patient_id: string, patient_name: string) => void;
  onOpenChart: (patient_id: string) => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function easternYmdOfIso(iso: string): string {
  return formatInTimeZone(new Date(iso), NY, "yyyy-MM-dd");
}

function easternHmOfIso(iso: string): string {
  return formatInTimeZone(new Date(iso), NY, "HH:mm");
}

function easternLocalToUtcIso(ymd: string, hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error("Invalid time");
  }
  const s = `${ymd}T${pad2(h)}:${pad2(m)}:00`;
  return toDate(s, { timeZone: NY }).toISOString();
}

function formatDob(value: string | null | undefined): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const d = new Date(s.includes("T") ? s : `${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${mo}/${day}/${d.getFullYear()}`;
}

function formatAppointmentWhen(startIso: string, typeLabel: string): string {
  try {
    const d = new Date(startIso);
    const datePart = formatInTimeZone(d, NY, "EEE MMM d");
    const timePart = formatInTimeZone(d, NY, "h:mm a");
    const type = typeLabel.trim() || "Appointment";
    return `${type} — ${datePart}, ${timePart}`;
  } catch {
    return typeLabel || "—";
  }
}

function formatCancelWhen(startIso: string): string {
  try {
    const d = new Date(startIso);
    const datePart = formatInTimeZone(d, NY, "EEE, MMM d");
    const timePart = formatInTimeZone(d, NY, "h:mm a");
    return `${datePart} at ${timePart}`;
  } catch {
    return "this time";
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className="mt-0.5 text-[13px] text-gray-900">{value || "—"}</p>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm disabled:opacity-50 ${
        variant === "danger"
          ? "text-red-700 hover:bg-red-50"
          : "text-gray-800 hover:bg-gray-50"
      }`}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export default function AppointmentPopup({
  appointment,
  anchorRect,
  clinicId,
  readOnly = false,
  onClose,
  onCheckIn,
  onCheckOut,
  onRescheduleConfirm,
  onCancelAppointment,
  onScheduleFollowUp,
  onOpenChart,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: anchorRect.top,
    left: anchorRect.right + 8,
  });
  const [insurance, setInsurance] = useState(
    appointment.insurance_carrier?.trim() || "",
  );
  const [diagnosis, setDiagnosis] = useState(
    appointment.diagnosis_code?.trim() || "",
  );
  const [dob, setDob] = useState("");
  const [rescheduleMode, setRescheduleMode] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(() =>
    easternYmdOfIso(appointment.start_time),
  );
  const [rescheduleTime, setRescheduleTime] = useState(() =>
    easternHmOfIso(appointment.start_time),
  );
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [cancelConfirmMode, setCancelConfirmMode] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);

  const status = (appointment.status || "").toLowerCase();
  const showCheckIn = status !== "checked_in" && status !== "completed";
  const showCheckOut = status === "checked_in";
  const showCancel = status !== "cancelled" && status !== "completed";

  useEffect(() => {
    setRescheduleDate(easternYmdOfIso(appointment.start_time));
    setRescheduleTime(easternHmOfIso(appointment.start_time));
    setRescheduleMode(false);
    setCancelConfirmMode(false);
  }, [appointment.id, appointment.start_time]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const h = await authHeaders();
        const [patientRes, apptRes] = await Promise.all([
          fetch(
            `${API_BASE}/patients/${encodeURIComponent(appointment.patient_id)}?clinic_id=${encodeURIComponent(clinicId)}`,
            { headers: h },
          ),
          appointment.diagnosis_code
            ? Promise.resolve(null)
            : fetch(
                `${API_BASE}/appointments/${encodeURIComponent(appointment.id)}?clinic_id=${encodeURIComponent(clinicId)}`,
                { headers: h },
              ),
        ]);
        if (!cancelled && patientRes?.ok) {
          const patientJson = (await patientRes.json()) as {
            insurance_carrier?: string | null;
            date_of_birth?: string | null;
          };
          const carrier = String(patientJson.insurance_carrier ?? "").trim();
          if (carrier) setInsurance(carrier);
          const formattedDob = formatDob(patientJson.date_of_birth);
          if (formattedDob) setDob(formattedDob);
        }
        if (!cancelled && apptRes?.ok) {
          const apptJson = (await apptRes.json()) as {
            diagnosis_code?: string | null;
          };
          const code = String(apptJson.diagnosis_code ?? "").trim();
          if (code) setDiagnosis(code);
        }
      } catch {
        /* keep placeholders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    appointment.id,
    appointment.patient_id,
    appointment.diagnosis_code,
    clinicId,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (cancelConfirmMode) {
        setCancelConfirmMode(false);
        return;
      }
      if (rescheduleMode) {
        setRescheduleMode(false);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, cancelConfirmMode, rescheduleMode]);

  const computePosition = useCallback(() => {
    const el = cardRef.current;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = el?.offsetWidth ?? 300;
    const cardH = el?.offsetHeight ?? 360;

    let left = anchorRect.right + margin;
    if (left + cardW > vw - margin) {
      left = anchorRect.left - cardW - margin;
    }
    left = Math.max(margin, Math.min(left, vw - cardW - margin));

    let top = anchorRect.top;
    top = Math.max(margin, Math.min(top, vh - cardH - margin));

    setPosition({ top, left });
  }, [anchorRect]);

  useLayoutEffect(() => {
    computePosition();
  }, [computePosition, rescheduleMode, cancelConfirmMode]);

  useEffect(() => {
    window.addEventListener("resize", computePosition);
    window.addEventListener("scroll", computePosition, true);
    return () => {
      window.removeEventListener("resize", computePosition);
      window.removeEventListener("scroll", computePosition, true);
    };
  }, [computePosition]);

  const apptWhen = formatAppointmentWhen(
    appointment.start_time,
    appointment.appointment_type,
  );
  const cancelWhen = formatCancelWhen(appointment.start_time);

  async function handleRescheduleSubmit() {
    if (!rescheduleDate || !rescheduleTime) return;
    setRescheduleBusy(true);
    try {
      const startIso = easternLocalToUtcIso(rescheduleDate, rescheduleTime);
      await onRescheduleConfirm(appointment.id, startIso);
    } catch {
      /* parent shows error toast; keep popup open */
    } finally {
      setRescheduleBusy(false);
    }
  }

  async function handleCancelConfirm() {
    setCancelBusy(true);
    try {
      await onCancelAppointment(appointment.id);
    } catch {
      /* parent shows error toast; keep popup open */
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[60]"
        aria-hidden
        onMouseDown={onClose}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal
        className="fixed z-[70] min-w-[280px] max-w-[320px] rounded-xl bg-white shadow-xl"
        style={{ top: position.top, left: position.left }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="relative border-b border-gray-100 px-4 py-3 pr-10">
          <p className="text-base font-bold text-gray-900">
            {appointment.patient_name}
          </p>
          <p className="mt-0.5 text-sm text-gray-500">
            {appointment.patient_phone?.trim() || "—"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-2 top-2 rounded-md px-2 py-1 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <InfoRow label="Appointment" value={apptWhen} />
          <InfoRow label="Clinician" value={appointment.clinician_name} />
          <InfoRow label="DOB" value={dob || "—"} />
          <InfoRow label="Insurance" value={insurance || "—"} />
          <InfoRow label="Diagnosis" value={diagnosis || "—"} />
        </div>

        {rescheduleMode ? (
          <div className="border-t border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">
              Reschedule appointment
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Same patient and provider — pick a new date and time.
            </p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium text-gray-500">
                Date
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-medium text-gray-500">
                Time
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setRescheduleMode(false)}
                disabled={rescheduleBusy}
              >
                Back
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-[#16A34A] px-3 py-2 text-sm font-medium text-white hover:bg-[#15803D] disabled:opacity-50"
                onClick={() => void handleRescheduleSubmit()}
                disabled={rescheduleBusy}
              >
                {rescheduleBusy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        ) : cancelConfirmMode ? (
          <div className="border-t border-gray-100 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">
              Cancel this appointment for {appointment.patient_name} on{" "}
              {cancelWhen}?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => setCancelConfirmMode(false)}
                disabled={cancelBusy}
              >
                Keep appointment
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                onClick={() => void handleCancelConfirm()}
                disabled={cancelBusy}
              >
                {cancelBusy ? "Cancelling…" : "Cancel appointment"}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-gray-100 px-2 py-2">
            {readOnly ? (
              <ActionButton
                icon="📋"
                label="Open Chart"
                onClick={() => onOpenChart(appointment.patient_id)}
              />
            ) : (
              <>
            {showCheckIn ? (
              <ActionButton
                icon="✅"
                label="Check In"
                onClick={() => onCheckIn(appointment.id)}
              />
            ) : null}
            {showCheckOut ? (
              <ActionButton
                icon="🏁"
                label="Check Out"
                onClick={() => onCheckOut(appointment.id)}
              />
            ) : null}
            <ActionButton
              icon="📅"
              label="Reschedule"
              onClick={() => setRescheduleMode(true)}
            />
            {showCancel ? (
              <ActionButton
                icon="✕"
                label="Cancel Appointment"
                variant="danger"
                onClick={() => setCancelConfirmMode(true)}
              />
            ) : null}
            <ActionButton
              icon="➕"
              label="Schedule Follow-Up"
              onClick={() =>
                onScheduleFollowUp(
                  appointment.patient_id,
                  appointment.patient_name,
                )
              }
            />
            <ActionButton
              icon="📋"
              label="Open Chart"
              onClick={() => onOpenChart(appointment.patient_id)}
            />
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

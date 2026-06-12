"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

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
  onClose: () => void;
  onCheckIn: (id: string) => void;
  onCheckOut: (id: string) => void;
  onReschedule: (appointment: AppointmentPopupData) => void;
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
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-gray-800 hover:bg-gray-50"
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
  onClose,
  onCheckIn,
  onCheckOut,
  onReschedule,
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

  const status = (appointment.status || "").toLowerCase();
  const showCheckIn = status !== "checked_in" && status !== "completed";
  const showCheckOut = status === "checked_in";

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
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
  }, [computePosition]);

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

        <div className="border-t border-gray-100 px-2 py-2">
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
            onClick={() => onReschedule(appointment)}
          />
          <ActionButton
            icon="➕"
            label="Schedule Follow-Up"
            onClick={() =>
              onScheduleFollowUp(appointment.patient_id, appointment.patient_name)
            }
          />
          <ActionButton
            icon="📋"
            label="Open Chart"
            onClick={() => onOpenChart(appointment.patient_id)}
          />
        </div>
      </div>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fromZonedTime } from "date-fns-tz";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { getEasternYMD } from "@/components/adminEastern";
import { WaitlistPatientOption } from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const NY = "America/New_York";

type ClinicianOption = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
};

type LocationOption = {
  id: string;
  name?: string;
};

type TreatmentTypeOption = {
  id: string;
  name?: string;
  duration_minutes?: number;
};

export type GroupSessionModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

function patientLabel(p: WaitlistPatientOption): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown";
}

function clinicianLabel(c: ClinicianOption): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return c.title ? `${n}, ${c.title}` : n || "Provider";
}

function addMinutesToHm(hm: string, minutes: number): string {
  const [hStr, mStr] = hm.split(":");
  let total = Number(hStr) * 60 + Number(mStr) + minutes;
  if (!Number.isFinite(total) || total < 0) total = 0;
  total = total % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function easternLocalToIso(ymd: string, hm: string): string {
  return fromZonedTime(`${ymd}T${hm}:00`, NY).toISOString();
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export default function GroupSessionModal({
  open,
  onClose,
  onCreated,
}: GroupSessionModalProps) {
  const { clinicId } = useClinic();
  const [title, setTitle] = useState("");
  const [clinicianId, setClinicianId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [treatmentTypeId, setTreatmentTypeId] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [capacity, setCapacity] = useState(6);
  const [notes, setNotes] = useState("");
  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [treatmentTypes, setTreatmentTypes] = useState<TreatmentTypeOption[]>([]);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<WaitlistPatientOption[]>(
    [],
  );
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [attendees, setAttendees] = useState<WaitlistPatientOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const treatmentTypeMap = useMemo(() => {
    const m = new Map<string, TreatmentTypeOption>();
    for (const t of treatmentTypes) m.set(t.id, t);
    return m;
  }, [treatmentTypes]);

  const searchPatients = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) return [];
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(q)}`,
        { headers: h },
      );
      const json = res.ok ? await res.json() : [];
      return Array.isArray(json) ? (json as WaitlistPatientOption[]) : [];
    },
    [clinicId],
  );

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setClinicianId("");
    setLocationId("");
    setTreatmentTypeId("");
    setSessionDate(getEasternYMD(new Date()));
    setStartTime("09:00");
    setEndTime("10:00");
    setCapacity(6);
    setNotes("");
    setPatientQuery("");
    setPatientResults([]);
    setPatientPickerOpen(false);
    setAttendees([]);
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open || !clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await authHeaders();
        const [clinRes, ttRes, locRes] = await Promise.all([
          fetch(
            `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
            { headers: h },
          ),
          fetch(
            `${API_BASE}/treatment-types?clinic_id=${encodeURIComponent(clinicId)}`,
            { headers: h },
          ),
          supabase
            .from("locations")
            .select("id,name")
            .eq("clinic_id", clinicId)
            .eq("is_active", true),
        ]);
        if (cancelled) return;
        const clinJson = clinRes.ok ? await clinRes.json() : [];
        const ttJson = ttRes.ok ? await ttRes.json() : [];
        const clinList = Array.isArray(clinJson) ? clinJson : [];
        const ttList = Array.isArray(ttJson) ? ttJson : [];
        setClinicians(clinList);
        setTreatmentTypes(ttList);
        setLocations((locRes.data as LocationOption[]) ?? []);
        if (clinList[0]?.id) setClinicianId(clinList[0].id);
        if ((locRes.data as LocationOption[])?.[0]?.id) {
          setLocationId((locRes.data as LocationOption[])[0].id);
        }
        if (ttList[0]?.id) {
          setTreatmentTypeId(ttList[0].id);
          const dur = Number(ttList[0].duration_minutes) || 60;
          setEndTime(addMinutesToHm("09:00", dur));
        }
      } catch {
        if (!cancelled) {
          setClinicians([]);
          setTreatmentTypes([]);
          setLocations([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clinicId]);

  useEffect(() => {
    if (!open || !patientPickerOpen) return;
    const q = patientQuery.trim();
    if (!q) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      (async () => {
        setSearchLoading(true);
        try {
          const rows = await searchPatients(q);
          if (!cancelled) setPatientResults(rows);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, patientPickerOpen, patientQuery, searchPatients]);

  useEffect(() => {
    if (!patientPickerOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [patientPickerOpen]);

  function handleTreatmentTypeChange(nextId: string) {
    setTreatmentTypeId(nextId);
    const tt = treatmentTypeMap.get(nextId);
    if (tt?.duration_minutes) {
      setEndTime(addMinutesToHm(startTime, Number(tt.duration_minutes) || 60));
    }
  }

  function handleStartTimeChange(next: string) {
    setStartTime(next);
    const tt = treatmentTypeMap.get(treatmentTypeId);
    if (tt?.duration_minutes) {
      setEndTime(addMinutesToHm(next, Number(tt.duration_minutes) || 60));
    }
  }

  function addAttendee(patient: WaitlistPatientOption) {
    if (attendees.some((a) => a.id === patient.id)) {
      setError("Patient is already added.");
      return;
    }
    if (attendees.length >= capacity) {
      setError(`Capacity is ${capacity}. Remove an attendee first.`);
      return;
    }
    setAttendees((prev) => [...prev, patient]);
    setPatientQuery("");
    setPatientPickerOpen(false);
    setError(null);
  }

  function removeAttendee(patientId: string) {
    setAttendees((prev) => prev.filter((a) => a.id !== patientId));
  }

  function handleClose() {
    if (busy) return;
    onClose();
  }

  async function handleSubmit() {
    if (!clinicianId.trim()) {
      setError("Select a clinician.");
      return;
    }
    if (!locationId.trim()) {
      setError("Select a location.");
      return;
    }
    if (!treatmentTypeId.trim()) {
      setError("Select a treatment type.");
      return;
    }
    if (!sessionDate.trim()) {
      setError("Date is required.");
      return;
    }
    if (!startTime.trim() || !endTime.trim()) {
      setError("Start and end times are required.");
      return;
    }
    if (capacity < 1) {
      setError("Capacity must be at least 1.");
      return;
    }
    if (attendees.length > capacity) {
      setError("Too many attendees for the selected capacity.");
      return;
    }

    const startIso = easternLocalToIso(sessionDate, startTime);
    const endIso = easternLocalToIso(sessionDate, endTime);
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setError("End time must be after start time.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/group-sessions`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          clinic_id: clinicId,
          clinician_id: clinicianId.trim(),
          location_id: locationId.trim(),
          treatment_type_id: treatmentTypeId.trim(),
          title: title.trim() || null,
          start_time: startIso,
          end_time: endIso,
          capacity,
          notes: notes.trim() || null,
          patient_ids: attendees.map((a) => a.id),
        }),
      });
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const detail =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        setError(detail);
        return;
      }
      onCreated?.();
      onClose();
    } catch {
      setError("Could not create group session.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="group-session-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="group-session-title"
          className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
        >
          New Group Session
        </h2>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="e.g. Group Dry Needling"
            />
            <span className="mt-0.5 block text-xs text-gray-400">
              Optional — defaults to treatment type name when blank
            </span>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Clinician
            <select
              value={clinicianId}
              onChange={(e) => setClinicianId(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            >
              <option value="">Select clinician…</option>
              {clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {clinicianLabel(c)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Location
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            >
              <option value="">Select location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name || l.id}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Treatment Type
            <select
              value={treatmentTypeId}
              onChange={(e) => handleTreatmentTypeChange(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            >
              <option value="">Select treatment type…</option>
              {treatmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name || t.id}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Date
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              Start Time
              <input
                type="time"
                value={startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                className={`mt-1 ${DS_INPUT}`}
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              End Time
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`mt-1 ${DS_INPUT}`}
                required
              />
            </label>
          </div>

          <label className="block text-sm font-medium text-gray-700">
            Capacity
            <input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
              className={`mt-1 ${DS_INPUT}`}
              required
            />
          </label>

          <div ref={pickerRef} className="relative">
            <label className="block text-sm font-medium text-gray-700">
              Initial Attendees
              <input
                type="text"
                value={patientQuery}
                onChange={(e) => {
                  setPatientQuery(e.target.value);
                  setPatientPickerOpen(true);
                }}
                onFocus={() => setPatientPickerOpen(true)}
                className={`mt-1 ${DS_INPUT}`}
                placeholder="Search patients to add…"
              />
              <span className="mt-0.5 block text-xs text-gray-400">
                Optional — {attendees.length}/{capacity} added
              </span>
            </label>
            {patientPickerOpen && (patientQuery.trim() || searchLoading) ? (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {searchLoading ? (
                  <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
                ) : patientResults.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-gray-500">
                    No patients found
                  </li>
                ) : (
                  patientResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onClick={() => addAttendee(p)}
                      >
                        {patientLabel(p)}
                        {p.phone ? (
                          <span className="ml-2 text-gray-400">{p.phone}</span>
                        ) : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {attendees.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {attendees.map((p) => (
                  <li
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-800"
                  >
                    {patientLabel(p)}
                    <button
                      type="button"
                      className="rounded-full px-1 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                      onClick={() => removeAttendee(p.id)}
                      aria-label={`Remove ${patientLabel(p)}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <label className="block text-sm font-medium text-gray-700">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className={DS_SECONDARY_BTN}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {busy ? "Creating…" : "Create Group Session"}
          </button>
        </div>
      </div>
    </div>
  );
}

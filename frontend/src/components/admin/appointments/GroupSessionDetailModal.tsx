"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { WaitlistPatientOption } from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const NY = "America/New_York";

const ATTENDEE_STATUSES = ["booked", "checked_in", "no_show", "cancelled"] as const;

type AttendeePatient = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

type GroupSessionAttendee = {
  id: string;
  patient_id: string;
  status: string;
  patients?: AttendeePatient | AttendeePatient[] | null;
};

type GroupSessionDetail = {
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
  attendee_count?: number;
  clinician_first_name?: string | null;
  clinician_last_name?: string | null;
  treatment_type_name?: string | null;
  attendees?: GroupSessionAttendee[];
};

export type GroupSessionDetailModalProps = {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function patientFromAttendee(a: GroupSessionAttendee): AttendeePatient {
  const p = a.patients;
  if (Array.isArray(p)) return p[0] ?? {};
  return p ?? {};
}

function patientLabel(a: GroupSessionAttendee): string {
  const p = patientFromAttendee(a);
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown";
}

function statusLabel(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === "checked_in") return "Checked in";
  if (s === "no_show") return "No show";
  if (s === "cancelled") return "Cancelled";
  return "Booked";
}

function clinicianName(detail: GroupSessionDetail | null): string {
  if (!detail) return "—";
  const n = `${detail.clinician_first_name ?? ""} ${detail.clinician_last_name ?? ""}`.trim();
  return n || "—";
}

export default function GroupSessionDetailModal({
  sessionId,
  open,
  onClose,
  onUpdated,
}: GroupSessionDetailModalProps) {
  const { clinicId } = useClinic();
  const [detail, setDetail] = useState<GroupSessionDetail | null>(null);
  const [locationName, setLocationName] = useState<string>("—");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<WaitlistPatientOption[]>([]);
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [statusPatchingPatientId, setStatusPatchingPatientId] = useState<string | null>(
    null,
  );
  const [statusPatchErrors, setStatusPatchErrors] = useState<Record<string, string>>({});
  const pickerRef = useRef<HTMLDivElement>(null);

  const loadDetail = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/api/group-sessions/${encodeURIComponent(sessionId)}`,
        { headers: h },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const msg =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        setError(msg);
        setDetail(null);
        return;
      }
      const json = (await res.json()) as GroupSessionDetail;
      setDetail(json);

      const locRes = await supabase
        .from("locations")
        .select("name")
        .eq("id", json.location_id)
        .limit(1);
      const locRow = locRes.data?.[0];
      setLocationName(
        locRow && typeof locRow.name === "string" && locRow.name.trim()
          ? locRow.name.trim()
          : "—",
      );
    } catch {
      setError("Could not load group session.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open || !sessionId) {
      setDetail(null);
      setError(null);
      setPatientQuery("");
      setPatientResults([]);
      setStatusPatchingPatientId(null);
      setStatusPatchErrors({});
      return;
    }
    void loadDetail();
  }, [open, sessionId, loadDetail]);

  useEffect(() => {
    if (!patientPickerOpen) return;
    function onDoc(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [patientPickerOpen]);

  useEffect(() => {
    if (!open || !patientPickerOpen) return;
    const q = patientQuery.trim();
    if (!q) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    void (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(q)}`,
          { headers: h },
        );
        const json = res.ok ? await res.json() : [];
        if (!cancelled) {
          setPatientResults(Array.isArray(json) ? (json as WaitlistPatientOption[]) : []);
        }
      } catch {
        if (!cancelled) setPatientResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patientPickerOpen, patientQuery, clinicId]);

  async function addAttendee(patient: WaitlistPatientOption) {
    if (!sessionId || !detail) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/group-sessions/${encodeURIComponent(sessionId)}/attendees`,
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ patient_id: patient.id }),
        },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const msg =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        setError(msg);
        return;
      }
      setPatientQuery("");
      setPatientPickerOpen(false);
      await loadDetail();
      onUpdated?.();
    } catch {
      setError("Could not add attendee.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAttendee(patientId: string, patientName: string) {
    if (!sessionId) return;
    if (!window.confirm(`Remove ${patientName} from this group session?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/group-sessions/${encodeURIComponent(sessionId)}/attendees/${encodeURIComponent(patientId)}`,
        { method: "DELETE", headers: await authHeaders() },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const msg =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        setError(msg);
        return;
      }
      await loadDetail();
      onUpdated?.();
    } catch {
      setError("Could not remove attendee.");
    } finally {
      setBusy(false);
    }
  }

  async function updateAttendeeStatus(
    patientId: string,
    newStatus: (typeof ATTENDEE_STATUSES)[number],
    previousStatus: string,
  ) {
    if (!sessionId) return;
    setStatusPatchingPatientId(patientId);
    setStatusPatchErrors((prev) => {
      const next = { ...prev };
      delete next[patientId];
      return next;
    });
    try {
      const res = await fetch(
        `${API_BASE}/api/group-sessions/${encodeURIComponent(sessionId)}/attendees/${encodeURIComponent(patientId)}`,
        {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const msg =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        setStatusPatchErrors((prev) => ({ ...prev, [patientId]: msg }));
        return;
      }
      setDetail((prev) => {
        if (!prev?.attendees) return prev;
        return {
          ...prev,
          attendees: prev.attendees.map((a) =>
            a.patient_id === patientId ? { ...a, status: newStatus } : a,
          ),
        };
      });
      if (newStatus === "cancelled" || previousStatus === "cancelled") {
        onUpdated?.();
      }
    } catch {
      setStatusPatchErrors((prev) => ({
        ...prev,
        [patientId]: "Could not update status.",
      }));
    } finally {
      setStatusPatchingPatientId(null);
    }
  }

  if (!open) return null;

  const title =
    (detail?.title || "").trim() ||
    (detail?.treatment_type_name || "").trim() ||
    "Group Session";
  const when =
    detail?.start_time && detail?.end_time
      ? `${formatInTimeZone(new Date(detail.start_time), NY, "EEE MMM d, yyyy · h:mm a")} – ${formatInTimeZone(new Date(detail.end_time), NY, "h:mm a")}`
      : "—";
  const activeAttendees =
    detail?.attendees?.filter((a) => a.status !== "cancelled") ?? [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="group-session-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="group-session-detail-title"
          className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
        >
          {title}
        </h2>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="mt-6 text-sm text-gray-500">Loading session…</p>
        ) : detail ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-400">Clinician</p>
                <p className="text-gray-900">{clinicianName(detail)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400">Location</p>
                <p className="text-gray-900">{locationName}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400">Treatment</p>
                <p className="text-gray-900">{detail.treatment_type_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400">Capacity</p>
                <p className="text-gray-900">
                  {activeAttendees.length}/{detail.capacity}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-gray-400">When</p>
                <p className="text-gray-900">{when}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400">Status</p>
                <p className="capitalize text-gray-900">{detail.status}</p>
              </div>
              {detail.notes?.trim() ? (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium text-gray-400">Notes</p>
                  <p className="text-gray-900">{detail.notes}</p>
                </div>
              ) : null}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">Attendees</h3>
              {activeAttendees.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No attendees yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100">
                  {activeAttendees.map((a) => {
                    const p = patientFromAttendee(a);
                    const name = patientLabel(a);
                    return (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {name}
                          </p>
                          <p className="truncate text-xs text-gray-500">
                            {p.phone?.trim() || "—"}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-2">
                            <select
                              value={a.status}
                              disabled={
                                busy || statusPatchingPatientId === a.patient_id
                              }
                              onChange={(e) => {
                                const next = e.target.value as (typeof ATTENDEE_STATUSES)[number];
                                if (next === a.status) return;
                                void updateAttendeeStatus(a.patient_id, next, a.status);
                              }}
                              className={`${DS_INPUT} w-auto min-w-[7rem] text-xs ${
                                statusPatchingPatientId === a.patient_id
                                  ? "opacity-60"
                                  : ""
                              }`}
                              aria-busy={statusPatchingPatientId === a.patient_id}
                            >
                              {ATTENDEE_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {statusLabel(s)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busy || statusPatchingPatientId === a.patient_id}
                              className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                              onClick={() => void removeAttendee(a.patient_id, name)}
                            >
                              Remove
                            </button>
                          </div>
                          {statusPatchingPatientId === a.patient_id ? (
                            <span className="text-[10px] text-gray-500">Saving…</span>
                          ) : null}
                          {statusPatchErrors[a.patient_id] ? (
                            <span className="max-w-[10rem] text-right text-[10px] text-red-600">
                              {statusPatchErrors[a.patient_id]}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div ref={pickerRef} className="relative border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">Add patient</h3>
              <input
                type="text"
                value={patientQuery}
                onChange={(e) => {
                  setPatientQuery(e.target.value);
                  setPatientPickerOpen(true);
                }}
                onFocus={() => setPatientPickerOpen(true)}
                className={`mt-2 ${DS_INPUT}`}
                placeholder="Search patients…"
                disabled={busy || activeAttendees.length >= detail.capacity}
              />
              {patientPickerOpen && (patientQuery.trim() || searchLoading) ? (
                <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {searchLoading ? (
                    <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
                  ) : patientResults.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">No patients found</li>
                  ) : (
                    patientResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => void addAttendee(p)}
                        >
                          {`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown"}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button type="button" className={DS_SECONDARY_BTN} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

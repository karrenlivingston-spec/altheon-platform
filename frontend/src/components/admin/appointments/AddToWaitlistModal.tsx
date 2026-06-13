"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  WaitlistPatientOption,
} from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type ClinicianOption = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
};

export type AddToWaitlistModalProps = {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
};

function patientLabel(p: WaitlistPatientOption): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown";
}

function clinicianLabel(c: ClinicianOption): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return c.title ? `${n}, ${c.title}` : n || "Provider";
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export default function AddToWaitlistModal({
  open,
  onClose,
  onAdded,
}: AddToWaitlistModalProps) {
  const { clinicId } = useClinic();
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<WaitlistPatientOption[]>(
    [],
  );
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] =
    useState<WaitlistPatientOption | null>(null);
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedTime, setRequestedTime] = useState("");
  const [clinicianId, setClinicianId] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

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
    setPatientQuery("");
    setPatientResults([]);
    setPatientPickerOpen(false);
    setSelectedPatient(null);
    setRequestedDate("");
    setRequestedTime("");
    setClinicianId("");
    setReason("");
    setNotes("");
    setError(null);
    setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open || !clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setClinicians(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setClinicians([]);
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

  function handleClose() {
    if (busy) return;
    onClose();
  }

  async function handleSubmit() {
    if (!selectedPatient?.id) {
      setError("Select a patient.");
      return;
    }
    if (!requestedDate.trim()) {
      setError("Requested date is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/waitlist`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: selectedPatient.id,
          requested_date: requestedDate.trim(),
          requested_time: requestedTime.trim() || null,
          clinician_id: clinicianId.trim() || null,
          reason: reason.trim() || null,
          notes: notes.trim() || null,
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
      onAdded?.();
      onClose();
    } catch {
      setError("Could not add to waitlist.");
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
        aria-labelledby="add-waitlist-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="add-waitlist-title"
          className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
        >
          Add to Waitlist
        </h2>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          <div ref={pickerRef} className="relative">
            <label className="block text-sm font-medium text-gray-700">
              Patient
              <input
                type="text"
                value={
                  selectedPatient && !patientPickerOpen
                    ? patientLabel(selectedPatient)
                    : patientQuery
                }
                onChange={(e) => {
                  setSelectedPatient(null);
                  setPatientQuery(e.target.value);
                  setPatientPickerOpen(true);
                }}
                onFocus={() => setPatientPickerOpen(true)}
                className={`mt-1 ${DS_INPUT}`}
                placeholder="Search by name or phone…"
                required
              />
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
                        onClick={() => {
                          setSelectedPatient(p);
                          setPatientQuery(patientLabel(p));
                          setPatientPickerOpen(false);
                        }}
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
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              Requested Date
              <input
                type="date"
                value={requestedDate}
                onChange={(e) => setRequestedDate(e.target.value)}
                className={`mt-1 ${DS_INPUT}`}
                required
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Requested Time
              <input
                type="time"
                value={requestedTime}
                onChange={(e) => setRequestedTime(e.target.value)}
                className={`mt-1 ${DS_INPUT}`}
              />
              <span className="mt-0.5 block text-xs text-gray-400">
                Leave blank for any time
              </span>
            </label>
          </div>

          <label className="block text-sm font-medium text-gray-700">
            Provider
            <select
              value={clinicianId}
              onChange={(e) => setClinicianId(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
            >
              <option value="">Any provider</option>
              {clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {clinicianLabel(c)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Reason
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="e.g. Fully booked that week"
            />
          </label>

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
            {busy ? "Adding…" : "Add to Waitlist"}
          </button>
        </div>
      </div>
    </div>
  );
}

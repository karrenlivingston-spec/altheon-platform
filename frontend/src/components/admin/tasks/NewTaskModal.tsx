"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";

import { DS_INPUT, DS_PRIMARY_BTN, DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import {
  API_BASE,
  authHeaders,
  staffDisplayName,
  type PatientOption,
  type StaffMember,
} from "@/lib/tasksMessaging";

type NewTaskModalProps = {
  clinicId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export default function NewTaskModal({
  clinicId,
  open,
  onClose,
  onCreated,
}: NewTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [patientId, setPatientId] = useState("");
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [searchingPatients, setSearchingPatients] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !clinicId) return;
    setTitle("");
    setDescription("");
    setPriority("normal");
    setAssignedTo("");
    setPatientId("");
    setPatientSearch("");
    setPatientResults([]);
    setError(null);
  }, [open, clinicId]);

  useEffect(() => {
    if (!open || !clinicId) return;
    let cancelled = false;
    (async () => {
      setLoadingStaff(true);
      try {
        const res = await fetch(
          `${API_BASE}/messaging/${encodeURIComponent(clinicId)}/staff`,
          { headers: await authHeaders() },
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setStaff(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setStaff([]);
      } finally {
        if (!cancelled) setLoadingStaff(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clinicId]);

  useEffect(() => {
    if (!open || !clinicId || !patientSearch.trim()) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setSearchingPatients(true);
        try {
          const res = await fetch(
            `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(patientSearch.trim())}`,
            { headers: await authHeaders() },
          );
          const data = res.ok ? await res.json() : [];
          if (!cancelled) setPatientResults(Array.isArray(data) ? data : []);
        } catch {
          if (!cancelled) setPatientResults([]);
        } finally {
          if (!cancelled) setSearchingPatients(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, clinicId, patientSearch]);

  const submit = useCallback(async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        title: title.trim(),
        priority,
        source: "manual",
      };
      if (description.trim()) body.description = description.trim();
      if (assignedTo) body.assigned_to = assignedTo;
      if (patientId) body.patient_id = patientId;

      const res = await fetch(`${API_BASE}/tasks/${encodeURIComponent(clinicId)}`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Failed to create task");
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }, [
    assignedTo,
    clinicId,
    description,
    onClose,
    onCreated,
    patientId,
    priority,
    title,
  ]);

  if (!open) return null;

  const selectedPatient = patientResults.find((p) => p.id === patientId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">New Task</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Title *
            </label>
            <input
              className={DS_INPUT}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Description
            </label>
            <textarea
              className={`${DS_INPUT} min-h-[88px] resize-y`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Priority
            </label>
            <select
              className={DS_INPUT}
              value={priority}
              onChange={(e) => setPriority(e.target.value as "normal" | "urgent")}
            >
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Assign To
            </label>
            <select
              className={DS_INPUT}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              disabled={loadingStaff}
            >
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {staffDisplayName(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Patient
            </label>
            <input
              className={DS_INPUT}
              value={patientSearch}
              onChange={(e) => {
                setPatientSearch(e.target.value);
                setPatientId("");
              }}
              placeholder="Search patients…"
            />
            {searchingPatients ? (
              <p className="mt-1 text-xs text-gray-500">Searching…</p>
            ) : null}
            {patientResults.length > 0 && !patientId ? (
              <ul className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-gray-200">
                {patientResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        setPatientId(p.id);
                        setPatientSearch(staffDisplayName(p));
                        setPatientResults([]);
                      }}
                    >
                      {staffDisplayName(p)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {patientId && selectedPatient ? (
              <p className="mt-1 text-xs text-teal-700">
                Selected: {staffDisplayName(selectedPatient)}
              </p>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={DS_SECONDARY_BTN} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className={DS_PRIMARY_BTN}
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </span>
            ) : (
              "Create Task"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

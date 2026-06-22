"use client";

import { useCallback, useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_SECTION_HEADER,
} from "@/app/admin/designSystem";
import { apiAuthHeaders } from "@/lib/apiAuth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const NY = "America/New_York";

const LABEL_CLASS =
  "block text-xs font-medium uppercase tracking-wide text-gray-500";
const FIELD_INPUT = `mt-1 w-full ${DS_INPUT}`;

type HEPExercise = {
  name: string;
  sets?: number | null;
  reps?: number | null;
  hold_seconds?: number | null;
  frequency?: string | null;
  notes?: string | null;
  video_url?: string | null;
};

type HEPProgram = {
  id: string;
  title?: string | null;
  created_at?: string | null;
  sent_at?: string | null;
  url?: string | null;
  exercises?: HEPExercise[] | null;
};

type ClinicianRow = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
};

type ExerciseDraft = {
  name: string;
  sets: string;
  reps: string;
  hold_seconds: string;
  frequency: string;
  notes: string;
  video_url: string;
};

function defaultExerciseDraft(): ExerciseDraft {
  return {
    name: "",
    sets: "",
    reps: "",
    hold_seconds: "",
    frequency: "",
    notes: "",
    video_url: "",
  };
}

function formatCreatedDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatInTimeZone(new Date(iso), NY, "MMM d, yyyy");
  } catch {
    return iso.slice(0, 10);
  }
}

function clinicianOptionLabel(c: ClinicianRow): string {
  const name = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  const titled = name ? `Dr. ${name}` : "Clinician";
  return c.title ? `${titled}, ${c.title}` : titled;
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

type PatientHEPTabProps = {
  patientId: string;
  clinicId: string;
  active: boolean;
};

export default function PatientHEPTab({
  patientId,
  clinicId,
  active,
}: PatientHEPTabProps) {
  const [programs, setPrograms] = useState<HEPProgram[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clinicians, setClinicians] = useState<ClinicianRow[]>([]);
  const [title, setTitle] = useState("");
  const [clinicianId, setClinicianId] = useState("");
  const [exercises, setExercises] = useState<ExerciseDraft[]>([
    defaultExerciseDraft(),
  ]);
  const [sendSms, setSendSms] = useState(true);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadPrograms = useCallback(async () => {
    if (!patientId.trim() || !clinicId.trim()) {
      setPrograms([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(
        `${API_BASE}/hep?patient_id=${encodeURIComponent(patientId)}&clinic_id=${encodeURIComponent(clinicId)}`,
        { headers },
      );
      if (!res.ok) {
        setLoadError(
          (await res.text().catch(() => "")).trim() ||
            `Could not load programs (${res.status})`,
        );
        setPrograms([]);
        return;
      }
      const json = await res.json();
      setPrograms(Array.isArray(json) ? json : []);
    } catch {
      setLoadError("Could not load programs.");
      setPrograms([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    if (!active) return;
    void loadPrograms();
  }, [active, loadPrograms]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!clinicId.trim()) {
        setClinicians([]);
        return;
      }
      try {
        const headers = await apiAuthHeaders();
        const res = await fetch(
          `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers },
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) {
          const rows = Array.isArray(data) ? (data as ClinicianRow[]) : [];
          setClinicians(rows);
          if (rows.length > 0) {
            setClinicianId((prev) => prev || rows[0].id);
          }
        }
      } catch {
        if (!cancelled) setClinicians([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  function resetForm() {
    setTitle("");
    setExercises([defaultExerciseDraft()]);
    setSendSms(true);
    setFormError(null);
    if (clinicians.length > 0) {
      setClinicianId(clinicians[0].id);
    }
  }

  function updateExercise(index: number, patch: Partial<ExerciseDraft>) {
    setExercises((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function handleCreate() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("Program title is required.");
      return;
    }
    if (!clinicianId) {
      setFormError("Select a clinician.");
      return;
    }
    const payloadExercises = exercises
      .map((row) => {
        const name = row.name.trim();
        if (!name) return null;
        return {
          name,
          sets: parseOptionalInt(row.sets),
          reps: parseOptionalInt(row.reps),
          hold_seconds: parseOptionalInt(row.hold_seconds),
          frequency: row.frequency.trim() || undefined,
          notes: row.notes.trim() || undefined,
          video_url: row.video_url.trim() || undefined,
        };
      })
      .filter(Boolean);
    if (payloadExercises.length === 0) {
      setFormError("Add at least one exercise with a name.");
      return;
    }

    setSubmitBusy(true);
    setFormError(null);
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(`${API_BASE}/hep`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: patientId,
          clinician_id: clinicianId,
          title: trimmedTitle,
          exercises: payloadExercises,
          send_sms: sendSms,
        }),
      });
      if (!res.ok) {
        setFormError(
          (await res.text().catch(() => "")).trim() ||
            `Could not create program (${res.status})`,
        );
        return;
      }
      resetForm();
      await loadPrograms();
      setToast(
        sendSms
          ? "Exercise program created. SMS sent to patient."
          : "Exercise program created.",
      );
    } catch {
      setFormError("Could not create program.");
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      {toast ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-sm">
          {toast}
        </div>
      ) : null}

      {loadError ? (
        <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {loadError}
        </p>
      ) : null}

      <div className={DS_CARD}>
        <h2 className={DS_SECTION_HEADER}>Home exercise programs</h2>
        {loading ? (
          <div className="space-y-3 py-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-gray-100 bg-gray-50"
              />
            ))}
          </div>
        ) : programs.length === 0 ? (
          <p className="py-6 text-sm text-gray-500">
            No exercise programs yet. Create one below.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {programs.map((program) => {
              const exerciseCount = Array.isArray(program.exercises)
                ? program.exercises.length
                : 0;
              const sent = Boolean(program.sent_at);
              return (
                <li
                  key={program.id}
                  className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-gray-900">
                      {(program.title ?? "").trim() || "Untitled program"}
                    </p>
                    <p className="text-sm text-gray-500">
                      Created {formatCreatedDate(program.created_at)}
                    </p>
                    <p className="text-sm text-gray-600">
                      {exerciseCount}{" "}
                      {exerciseCount === 1 ? "exercise" : "exercises"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        sent
                          ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
                          : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                      }
                    >
                      {sent ? "Sent" : "Not Sent"}
                    </span>
                    {program.url ? (
                      <a
                        href={program.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${DS_SECONDARY_BTN} text-xs`}
                      >
                        View
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={DS_CARD}>
        <h2 className={DS_SECTION_HEADER}>Create program</h2>
        {formError ? (
          <p className="mb-4 rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
            {formError}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className={LABEL_CLASS}>Title</span>
            <input
              className={FIELD_INPUT}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Low back recovery — week 1"
            />
          </div>
          <div>
            <span className={LABEL_CLASS}>Clinician</span>
            <select
              className={FIELD_INPUT}
              value={clinicianId}
              onChange={(e) => setClinicianId(e.target.value)}
            >
              {clinicians.length === 0 ? (
                <option value="">No clinicians available</option>
              ) : (
                clinicians.map((c) => (
                  <option key={c.id} value={c.id}>
                    {clinicianOptionLabel(c)}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Exercises</h3>
            <button
              type="button"
              className={DS_SECONDARY_BTN}
              onClick={() =>
                setExercises((rows) => [...rows, defaultExerciseDraft()])
              }
            >
              + Add Exercise
            </button>
          </div>

          {exercises.map((row, index) => (
            <div
              key={index}
              className="rounded-xl border border-gray-100 bg-gray-50/60 p-4"
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  <span className={LABEL_CLASS}>Name</span>
                  <input
                    className={FIELD_INPUT}
                    value={row.name}
                    onChange={(e) =>
                      updateExercise(index, { name: e.target.value })
                    }
                    placeholder="Exercise name"
                  />
                </div>
                <div>
                  <span className={LABEL_CLASS}>Sets</span>
                  <input
                    type="number"
                    min={0}
                    className={FIELD_INPUT}
                    value={row.sets}
                    onChange={(e) =>
                      updateExercise(index, { sets: e.target.value })
                    }
                  />
                </div>
                <div>
                  <span className={LABEL_CLASS}>Reps</span>
                  <input
                    type="number"
                    min={0}
                    className={FIELD_INPUT}
                    value={row.reps}
                    onChange={(e) =>
                      updateExercise(index, { reps: e.target.value })
                    }
                  />
                </div>
                <div>
                  <span className={LABEL_CLASS}>Hold (sec)</span>
                  <input
                    type="number"
                    min={0}
                    className={FIELD_INPUT}
                    value={row.hold_seconds}
                    onChange={(e) =>
                      updateExercise(index, { hold_seconds: e.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <span className={LABEL_CLASS}>Frequency</span>
                  <input
                    className={FIELD_INPUT}
                    value={row.frequency}
                    onChange={(e) =>
                      updateExercise(index, { frequency: e.target.value })
                    }
                    placeholder="e.g. 2x per day"
                  />
                </div>
                <div className="sm:col-span-2">
                  <span className={LABEL_CLASS}>Notes</span>
                  <input
                    className={FIELD_INPUT}
                    value={row.notes}
                    onChange={(e) =>
                      updateExercise(index, { notes: e.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <span className={LABEL_CLASS}>Video URL</span>
                  <input
                    className={FIELD_INPUT}
                    value={row.video_url}
                    onChange={(e) =>
                      updateExercise(index, { video_url: e.target.value })
                    }
                    placeholder="https://"
                  />
                </div>
              </div>
              {exercises.length > 1 ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="text-xs font-medium text-red-600 hover:text-red-700"
                    onClick={() =>
                      setExercises((rows) =>
                        rows.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-[#0d9488] focus:ring-[#0d9488]"
            checked={sendSms}
            onChange={(e) => setSendSms(e.target.checked)}
          />
          Send SMS to patient immediately
        </label>

        <div className="mt-6">
          <button
            type="button"
            disabled={submitBusy}
            onClick={() => void handleCreate()}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {submitBusy ? "Creating…" : "Create & Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

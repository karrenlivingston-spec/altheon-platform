export type LibraryExercise = {
  id: string;
  name?: string | null;
  category?: string | null;
  body_region?: string | null;
  description?: string | null;
  instructions?: string | null;
  default_sets?: number | null;
  default_reps?: number | null;
  default_hold_seconds?: number | null;
  default_frequency?: string | null;
  notes_template?: string | null;
  contraindications?: string | null;
  video_url?: string | null;
  ai_reason?: string | null;
};

export type HEPExerciseDraft = {
  library_id: string;
  name: string;
  sets: string;
  reps: string;
  hold_seconds: string;
  frequency: string;
  notes: string;
  video_url: string;
};

export type HEPExercisePayload = {
  name: string;
  sets?: number;
  reps?: number;
  hold_seconds?: number;
  frequency?: string;
  notes?: string;
  video_url?: string;
};

export const HEP_LIBRARY_CATEGORIES = [
  "All",
  "Cervical",
  "Lumbar/Core",
  "Shoulder",
  "Hip & Knee",
  "Ankle & Foot",
  "General Mobility & Stretching",
  "Dry Needling Recovery",
  "Neurodynamics",
] as const;

export type HEPLibraryCategory = (typeof HEP_LIBRARY_CATEGORIES)[number];

export function libraryExerciseToDraft(exercise: LibraryExercise): HEPExerciseDraft {
  return {
    library_id: exercise.id,
    name: (exercise.name ?? "").trim(),
    sets:
      exercise.default_sets != null ? String(exercise.default_sets) : "",
    reps:
      exercise.default_reps != null ? String(exercise.default_reps) : "",
    hold_seconds:
      exercise.default_hold_seconds != null
        ? String(exercise.default_hold_seconds)
        : "",
    frequency: (exercise.default_frequency ?? "").trim(),
    notes: (exercise.notes_template ?? "").trim(),
    video_url: (exercise.video_url ?? "").trim(),
  };
}

export function formatLibraryDefaultLine(exercise: LibraryExercise): string {
  const parts: string[] = [];
  const sets = exercise.default_sets;
  const reps = exercise.default_reps;
  if (sets != null && reps != null) {
    parts.push(`${sets}×${reps}`);
  } else if (sets != null) {
    parts.push(`${sets} sets`);
  } else if (reps != null) {
    parts.push(`${reps} reps`);
  }
  if (exercise.default_hold_seconds != null) {
    parts.push(`${exercise.default_hold_seconds} sec`);
  }
  if ((exercise.default_frequency ?? "").trim()) {
    parts.push(String(exercise.default_frequency).trim());
  }
  return parts.length > 0 ? parts.join(", ") : "—";
}

export function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export function draftsToPayload(rows: HEPExerciseDraft[]): HEPExercisePayload[] {
  const out: HEPExercisePayload[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    out.push({
      name,
      sets: parseOptionalInt(row.sets),
      reps: parseOptionalInt(row.reps),
      hold_seconds: parseOptionalInt(row.hold_seconds),
      frequency: row.frequency.trim() || undefined,
      notes: row.notes.trim() || undefined,
      video_url: row.video_url.trim() || undefined,
    });
  }
  return out;
}

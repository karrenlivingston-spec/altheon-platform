"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";

import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  formatLibraryDefaultLine,
  HEP_LIBRARY_CATEGORIES,
  libraryExerciseToDraft,
  type HEPLibraryCategory,
  type HEPExerciseDraft,
  type LibraryExercise,
} from "@/components/admin/patients/hepTypes";
import { apiAuthHeaders } from "@/lib/apiAuth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type ClinicalNoteRow = {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  created_at?: string | null;
};

type ExerciseLibraryModalProps = {
  open: boolean;
  clinicId: string;
  patientId: string;
  initialSelected: HEPExerciseDraft[];
  onClose: () => void;
  onConfirm: (exercises: HEPExerciseDraft[]) => void;
};

function noteSoapText(note: ClinicalNoteRow): string {
  return [
    note.subjective,
    note.objective,
    note.assessment,
    note.plan,
  ]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export default function ExerciseLibraryModal({
  open,
  clinicId,
  patientId,
  initialSelected,
  onClose,
  onConfirm,
}: ExerciseLibraryModalProps) {
  const [library, setLibrary] = useState<LibraryExercise[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<HEPLibraryCategory>("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [aiHighlightedIds, setAiHighlightedIds] = useState<Set<string>>(
    new Set(),
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiToast, setAiToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set(initialSelected.map((row) => row.library_id)));
    setSearch("");
    setCategory("All");
    setAiHighlightedIds(new Set());
    setAiMessage(null);
    setAiToast(null);
  }, [open, initialSelected]);

  useEffect(() => {
    if (!aiToast) return;
    const t = window.setTimeout(() => setAiToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [aiToast]);

  const loadLibrary = useCallback(async () => {
    if (!clinicId.trim()) {
      setLibrary([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(
        `${API_BASE}/hep/library?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers },
      );
      if (!res.ok) {
        setLoadError(
          (await res.text().catch(() => "")).trim() ||
            `Could not load library (${res.status})`,
        );
        setLibrary([]);
        return;
      }
      const json = await res.json();
      setLibrary(Array.isArray(json) ? json : []);
    } catch {
      setLoadError("Could not load exercise library.");
      setLibrary([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    if (!open) return;
    void loadLibrary();
  }, [open, loadLibrary]);

  const filteredExercises = useMemo(() => {
    let rows = library;
    if (category !== "All") {
      rows = rows.filter(
        (row) => (row.category ?? "").trim() === category,
      );
    }
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        (row.name ?? "").toLowerCase().includes(q) ||
        (row.description ?? "").toLowerCase().includes(q) ||
        (row.category ?? "").toLowerCase().includes(q) ||
        (row.body_region ?? "").toLowerCase().includes(q),
    );
  }, [library, category, search]);

  const libraryById = useMemo(
    () => new Map(library.map((row) => [row.id, row])),
    [library],
  );

  function toggleExercise(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAiSuggest() {
    if (!clinicId.trim() || !patientId.trim()) return;
    setAiBusy(true);
    setAiMessage(null);
    setAiToast(null);
    try {
      const headers = await apiAuthHeaders();
      const notesRes = await fetch(
        `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/clinical-notes`,
        { headers },
      );

      let soapText = "";
      if (notesRes.ok) {
        const rows = await notesRes.json();
        const notes = Array.isArray(rows) ? (rows as ClinicalNoteRow[]) : [];
        if (notes.length > 0) {
          soapText = noteSoapText(notes[0]);
        }
      }

      if (!soapText) {
        setAiMessage("No recent SOAP note found. Select exercises manually.");
        return;
      }

      const suggestRes = await fetch(`${API_BASE}/hep/ai-suggest`, {
        method: "POST",
        headers,
        body: JSON.stringify({ clinic_id: clinicId, soap_text: soapText }),
      });
      if (!suggestRes.ok) {
        setAiMessage(
          (await suggestRes.text().catch(() => "")).trim() ||
            "AI suggestion failed. Select exercises manually.",
        );
        return;
      }
      const suggestions = (await suggestRes.json()) as LibraryExercise[];
      const ids = (Array.isArray(suggestions) ? suggestions : [])
        .map((row) => String(row.id ?? "").trim())
        .filter(Boolean);

      if (ids.length === 0) {
        setAiMessage("No exercises were suggested. Select exercises manually.");
        return;
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      setAiHighlightedIds(new Set(ids));
      setAiToast(
        `AI suggested ${ids.length} exercise${ids.length === 1 ? "" : "s"} based on recent SOAP note.`,
      );
    } catch {
      setAiMessage("AI suggestion failed. Select exercises manually.");
    } finally {
      setAiBusy(false);
    }
  }

  function handleConfirm() {
    const merged = new Map<string, HEPExerciseDraft>();
    for (const row of initialSelected) {
      merged.set(row.library_id, row);
    }
    for (const id of selectedIds) {
      if (merged.has(id)) continue;
      const libRow = libraryById.get(id);
      if (libRow) merged.set(id, libraryExerciseToDraft(libRow));
    }
    const kept = [...selectedIds]
      .map((id) => merged.get(id))
      .filter((row): row is HEPExerciseDraft => Boolean(row));
    onConfirm(kept);
    onClose();
  }

  if (!open) return null;

  const selectedCount = selectedIds.size;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      {aiToast ? (
        <div className="pointer-events-none fixed bottom-6 right-6 z-[80] rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800 shadow-sm">
          {aiToast}
        </div>
      ) : null}

      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Exercise Library
          </h2>
          <p className="text-sm text-gray-500">
            {selectedCount} selected
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div className="shrink-0 space-y-3 border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            className={`flex-1 ${DS_INPUT}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exercises…"
          />
          <button
            type="button"
            disabled={aiBusy}
            onClick={() => void handleAiSuggest()}
            className={`${DS_SECONDARY_BTN} inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-60`}
          >
            {aiBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4 text-blue-600" aria-hidden />
            )}
            AI Suggest from SOAP
          </button>
        </div>
        {aiMessage ? (
          <p className="text-sm text-amber-800">{aiMessage}</p>
        ) : null}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {HEP_LIBRARY_CATEGORIES.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setCategory(tab)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                category === tab
                  ? "bg-[#0d9488] text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-xl border border-gray-100 bg-gray-50"
              />
            ))}
          </div>
        ) : loadError ? (
          <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </p>
        ) : filteredExercises.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">
            No exercises match your filters.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredExercises.map((exercise) => {
              const id = exercise.id;
              const added = selectedIds.has(id);
              const aiPick = aiHighlightedIds.has(id);
              return (
                <article
                  key={id}
                  className={`flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${
                    aiPick ? "ring-2 ring-blue-500 ring-offset-1" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900">
                        {(exercise.name ?? "").trim() || "Exercise"}
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">
                        {[exercise.category, exercise.body_region]
                          .filter((part) => (part ?? "").trim())
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleExercise(id)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                        added
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      {added ? "✓ Added" : "+ Add"}
                    </button>
                  </div>
                  {(exercise.description ?? "").trim() ? (
                    <p className="mt-3 line-clamp-3 text-sm text-gray-600">
                      {exercise.description}
                    </p>
                  ) : null}
                  <p className="mt-3 text-xs font-medium text-gray-500">
                    Default: {formatLibraryDefaultLine(exercise)}
                  </p>
                  {exercise.ai_reason ? (
                    <p className="mt-2 text-xs text-blue-700">
                      {exercise.ai_reason}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-4 py-4 sm:px-6">
        <button type="button" onClick={onClose} className={DS_SECONDARY_BTN}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={selectedCount === 0}
          className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
        >
          Add {selectedCount} Exercise{selectedCount === 1 ? "" : "s"} →
        </button>
      </footer>
    </div>
  );
}

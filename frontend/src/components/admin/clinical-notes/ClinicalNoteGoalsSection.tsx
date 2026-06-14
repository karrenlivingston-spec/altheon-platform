"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  GoalSuggestion,
  NoteGoal,
} from "@/components/admin/clinical-notes/clinicalNotesTypes";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type ClinicalNoteGoalsSectionProps = {
  noteId: string | null;
  assessmentText: string;
  onError?: (message: string) => void;
};

function snapPercent(value: number): number {
  const n = Math.max(0, Math.min(100, Math.round(value / 5) * 5));
  return n;
}

export default function ClinicalNoteGoalsSection({
  noteId,
  assessmentText,
  onError,
}: ClinicalNoteGoalsSectionProps) {
  const [goals, setGoals] = useState<NoteGoal[]>([]);
  const [suggestions, setSuggestions] = useState<GoalSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    if (!noteId) {
      setGoals([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/goals`,
      );
      const json = res.ok ? await res.json() : [];
      setGoals(Array.isArray(json) ? (json as NoteGoal[]) : []);
    } catch {
      setGoals([]);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  async function handleSuggest() {
    if (!noteId) {
      onError?.("Save the note as a draft first to add goals.");
      return;
    }
    setSuggesting(true);
    setSuggestions([]);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/suggest-goals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assessment_text: assessmentText }),
        },
      );
      const json = res.ok ? await res.json() : [];
      setSuggestions(Array.isArray(json) ? (json as GoalSuggestion[]) : []);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggesting(false);
    }
  }

  async function addGoalFromSuggestion(s: GoalSuggestion) {
    if (!noteId) return;
    setBusyGoalId("new");
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/goals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: s.description,
            goal_type: s.goal_type,
            target_weeks: s.target_weeks,
          }),
        },
      );
      if (!res.ok) {
        onError?.(await res.text().catch(() => "Failed to add goal"));
        return;
      }
      setSuggestions((prev) =>
        prev.filter((x) => x.description !== s.description),
      );
      await loadGoals();
    } finally {
      setBusyGoalId(null);
    }
  }

  async function handleAddBlank() {
    if (!noteId) {
      onError?.("Save the note as a draft first to add goals.");
      return;
    }
    setBusyGoalId("new");
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/goals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: "New goal",
            goal_type: "short_term",
            target_weeks: null,
          }),
        },
      );
      if (!res.ok) {
        onError?.(await res.text().catch(() => "Failed to add goal"));
        return;
      }
      await loadGoals();
    } finally {
      setBusyGoalId(null);
    }
  }

  function updateLocalGoal(goalId: string, patch: Partial<NoteGoal>) {
    setGoals((prev) =>
      prev.map((g) => (g.id === goalId ? { ...g, ...patch } : g)),
    );
  }

  async function saveGoal(goal: NoteGoal) {
    if (!noteId) return;
    setBusyGoalId(goal.id);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/goals/${encodeURIComponent(goal.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: goal.description,
            goal_type: goal.goal_type,
            target_weeks: goal.target_weeks,
            percent_met: snapPercent(goal.percent_met),
          }),
        },
      );
      if (!res.ok) {
        onError?.(await res.text().catch(() => "Failed to save goal"));
        return;
      }
      const updated = (await res.json()) as NoteGoal;
      setGoals((prev) => prev.map((g) => (g.id === goal.id ? updated : g)));
    } finally {
      setBusyGoalId(null);
    }
  }

  async function deleteGoal(goalId: string) {
    if (!noteId) return;
    setBusyGoalId(goalId);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/goals/${encodeURIComponent(goalId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        onError?.(await res.text().catch(() => "Failed to delete goal"));
        return;
      }
      setGoals((prev) => prev.filter((g) => g.id !== goalId));
    } finally {
      setBusyGoalId(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Goals</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={suggesting || !noteId}
            onClick={() => void handleSuggest()}
            className={`${DS_SECONDARY_BTN} text-xs disabled:opacity-50`}
          >
            {suggesting ? "Suggesting…" : "Suggest Goals"}
          </button>
          <button
            type="button"
            disabled={busyGoalId === "new" || !noteId}
            onClick={() => void handleAddBlank()}
            className={`${DS_SECONDARY_BTN} text-xs disabled:opacity-50`}
          >
            + Add Goal
          </button>
        </div>
      </div>

      {!noteId ? (
        <p className="text-xs text-gray-500">
          Save the note as a draft to create and manage goals.
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul className="mb-4 space-y-2 rounded-lg border border-teal-100 bg-teal-50/60 p-3">
          <li className="text-xs font-medium text-teal-900">Suggested goals</li>
          {suggestions.map((s, i) => (
            <li
              key={`${s.description}-${i}`}
              className="flex items-start justify-between gap-2 text-sm text-teal-950"
            >
              <span className="min-w-0 flex-1">
                {s.description}
                <span className="ml-2 text-xs text-teal-700">
                  ({s.goal_type === "long_term" ? "Long term" : "Short term"}
                  {s.target_weeks != null ? ` · ${s.target_weeks} wk` : ""})
                </span>
              </span>
              <button
                type="button"
                disabled={busyGoalId === "new"}
                onClick={() => void addGoalFromSuggestion(s)}
                className="shrink-0 rounded border border-teal-300 bg-white px-2 py-0.5 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50"
              >
                +
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading goals…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-gray-500">No goals yet.</p>
      ) : (
        <ul className="space-y-4">
          {goals.map((goal) => {
            const busy = busyGoalId === goal.id;
            return (
              <li
                key={goal.id}
                className="rounded-lg border border-gray-200 bg-white p-3 space-y-3"
              >
                <textarea
                  value={goal.description}
                  onChange={(e) =>
                    updateLocalGoal(goal.id, { description: e.target.value })
                  }
                  rows={2}
                  className={`w-full ${DS_INPUT} text-sm`}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex rounded-lg border border-gray-200 p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        updateLocalGoal(goal.id, { goal_type: "short_term" })
                      }
                      className={`rounded-md px-2 py-1 ${
                        goal.goal_type === "short_term"
                          ? "bg-gray-900 text-white"
                          : "text-gray-600"
                      }`}
                    >
                      Short term
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateLocalGoal(goal.id, { goal_type: "long_term" })
                      }
                      className={`rounded-md px-2 py-1 ${
                        goal.goal_type === "long_term"
                          ? "bg-gray-900 text-white"
                          : "text-gray-600"
                      }`}
                    >
                      Long term
                    </button>
                  </div>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    Target weeks
                    <input
                      type="number"
                      min={0}
                      value={goal.target_weeks ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateLocalGoal(goal.id, {
                          target_weeks: v === "" ? null : Number(v),
                        });
                      }}
                      className={`w-16 ${DS_INPUT} py-1 text-xs`}
                    />
                  </label>
                  <label className="flex min-w-[140px] flex-1 items-center gap-2 text-xs text-gray-600">
                    Progress {snapPercent(goal.percent_met)}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={snapPercent(goal.percent_met)}
                      onChange={(e) =>
                        updateLocalGoal(goal.id, {
                          percent_met: Number(e.target.value),
                        })
                      }
                      className="flex-1"
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveGoal(goal)}
                    className={`${DS_PRIMARY_BTN} text-xs disabled:opacity-50`}
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteGoal(goal.id)}
                    className={`${DS_SECONDARY_BTN} text-xs disabled:opacity-50`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

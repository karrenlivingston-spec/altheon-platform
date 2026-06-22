"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { apiAuthHeaders } from "@/lib/apiAuth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type TestResult = "Positive" | "Negative" | "Not Tested";

type CatalogTest = { id: string; test_name: string };
type CatalogSubcategory = { subcategory: string; tests: CatalogTest[] };
type CatalogRegion = { region: string; subcategories: CatalogSubcategory[] };

type SavedResultRow = {
  test_id: string;
  test_name?: string;
  region?: string;
  subcategory?: string;
  result?: string;
  clinician_notes?: string;
};

type Entry = { result: TestResult; notes: string };

const RESULT_OPTIONS: TestResult[] = ["Positive", "Negative", "Not Tested"];

function pillClass(option: TestResult, selected: boolean): string {
  const base =
    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default";
  if (!selected) {
    return `${base} border-gray-200 bg-white text-gray-500 hover:bg-gray-50`;
  }
  switch (option) {
    case "Positive":
      return `${base} border-teal-600 bg-teal-600 text-white`;
    case "Negative":
      return `${base} border-gray-500 bg-gray-500 text-white`;
    default:
      return `${base} border-gray-300 bg-gray-200 text-gray-700`;
  }
}

export function SpecialTestsSection({
  noteId,
  clinicId,
  readOnly = false,
  onSaved,
}: {
  noteId: string | null;
  clinicId: string;
  readOnly?: boolean;
  onSaved?: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [catalog, setCatalog] = useState<CatalogRegion[] | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedCount, setSavedCount] = useState(0);
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSavedResults = useCallback(async () => {
    if (!noteId || !clinicId) return;
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/special-tests?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { results?: SavedResultRow[] };
      const rows = Array.isArray(json.results) ? json.results : [];
      const next: Record<string, Entry> = {};
      const ids = new Set<string>();
      let count = 0;
      for (const row of rows) {
        const id = String(row.test_id ?? "").trim();
        if (!id) continue;
        const result = (RESULT_OPTIONS as string[]).includes(row.result ?? "")
          ? (row.result as TestResult)
          : "Not Tested";
        next[id] = { result, notes: String(row.clinician_notes ?? "") };
        ids.add(id);
        if (result !== "Not Tested") count += 1;
      }
      setEntries(next);
      setSavedIds(ids);
      setSavedCount(count);
    } catch {
      /* badge is non-critical */
    }
  }, [noteId, clinicId]);

  // Count badge needs saved results even while collapsed.
  useEffect(() => {
    void loadSavedResults();
  }, [loadSavedResults]);

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (!next || catalog) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(`${API_BASE}/api/clinical-notes/special-tests`, {
        headers,
      });
      if (!res.ok) {
        setError("Could not load the special tests library.");
        return;
      }
      const json = (await res.json()) as { regions?: CatalogRegion[] };
      setCatalog(Array.isArray(json.regions) ? json.regions : []);
      await loadSavedResults();
    } catch {
      setError("Could not load the special tests library.");
    } finally {
      setLoading(false);
    }
  }

  function setResult(testId: string, result: TestResult) {
    if (readOnly) return;
    setEntries((prev) => ({
      ...prev,
      [testId]: { result, notes: prev[testId]?.notes ?? "" },
    }));
  }

  function setNotes(testId: string, notes: string) {
    if (readOnly) return;
    setEntries((prev) => ({
      ...prev,
      [testId]: { result: prev[testId]?.result ?? "Not Tested", notes },
    }));
  }

  async function handleSave() {
    if (!noteId || !clinicId || readOnly) return;
    // Skip untouched tests, but include previously saved rows reset to
    // "Not Tested" so toggling a result back still updates the record.
    const payload = Object.entries(entries)
      .filter(
        ([id, e]) => e.result !== "Not Tested" || savedIds.has(id),
      )
      .map(([id, e]) => ({
        test_id: id,
        result: e.result,
        clinician_notes: e.notes.trim() || null,
      }));
    setSaving(true);
    setError(null);
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/special-tests?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ results: payload }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => "Save failed"));
        return;
      }
      setSavedIds(new Set(payload.map((p) => p.test_id)));
      setSavedCount(
        payload.filter((p) => p.result !== "Not Tested").length,
      );
      onSaved?.("Special tests saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleRegion(region: string) {
    setOpenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  }

  return (
    <div className="rounded-xl border border-gray-200">
      <button
        type="button"
        onClick={() => void handleExpand()}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-gray-50"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
          Special Tests
        </span>
        {savedCount > 0 ? (
          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700">
            {savedCount} recorded
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="border-t border-gray-100 px-4 py-4">
          {!noteId ? (
            <p className="text-sm text-gray-500">
              Save the note as a draft first to record special tests.
            </p>
          ) : null}

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading test library…
            </p>
          ) : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {catalog ? (
            <div className="space-y-2">
              {catalog.map((region) => {
                const open = openRegions.has(region.region);
                const regionCount = region.subcategories.reduce(
                  (acc, sub) =>
                    acc +
                    sub.tests.filter(
                      (t) =>
                        (entries[t.id]?.result ?? "Not Tested") !==
                        "Not Tested",
                    ).length,
                  0,
                );
                return (
                  <div
                    key={region.region}
                    className="rounded-lg border border-gray-100"
                  >
                    <button
                      type="button"
                      onClick={() => toggleRegion(region.region)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                      aria-expanded={open}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                        {open ? (
                          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                        )}
                        {region.region}
                      </span>
                      {regionCount > 0 ? (
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                          {regionCount}
                        </span>
                      ) : null}
                    </button>

                    {open ? (
                      <div className="space-y-3 border-t border-gray-100 px-3 py-3">
                        {region.subcategories.map((sub) => (
                          <div key={sub.subcategory}>
                            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                              {sub.subcategory}
                            </p>
                            <div className="space-y-2">
                              {sub.tests.map((test) => {
                                const entry = entries[test.id] ?? {
                                  result: "Not Tested" as TestResult,
                                  notes: "",
                                };
                                return (
                                  <div key={test.id}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-sm text-gray-800">
                                        {test.test_name}
                                      </span>
                                      <div className="flex gap-1.5">
                                        {RESULT_OPTIONS.map((option) => (
                                          <button
                                            key={option}
                                            type="button"
                                            disabled={readOnly}
                                            onClick={() =>
                                              setResult(test.id, option)
                                            }
                                            className={pillClass(
                                              option,
                                              entry.result === option,
                                            )}
                                          >
                                            {option}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                    {entry.result !== "Not Tested" ? (
                                      <input
                                        type="text"
                                        value={entry.notes}
                                        readOnly={readOnly}
                                        onChange={(e) =>
                                          setNotes(test.id, e.target.value)
                                        }
                                        placeholder="Notes..."
                                        className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none read-only:bg-gray-50"
                                      />
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {catalog && !readOnly && noteId ? (
            <div className="mt-4 flex justify-end border-t border-gray-100 pt-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Special Tests"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

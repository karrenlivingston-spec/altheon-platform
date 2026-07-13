"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { apiAuthHeaders } from "@/lib/apiAuth";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type NeuroSide = "left" | "right" | "bilateral";

type CatalogItem = { id: string; name: string; sort_order: number };
type CatalogRegion = { region: string; items: CatalogItem[] };
type CatalogCategory = { category: string; regions: CatalogRegion[] };

type SavedResultRow = {
  item_id: string;
  name?: string;
  category?: string;
  region?: string;
  sort_order?: number;
  side?: string;
  result?: string;
  clinician_notes?: string;
};

type Entry = { result: string; notes: string };

/** split = Left + Right rows; bilateral = single Bilateral row */
type SideLayout = "split" | "bilateral";

const RESULT_OPTIONS_BY_CATEGORY: Record<string, string[]> = {
  sensory: ["Intact", "Diminished", "Absent"],
  motor: ["5/5", "4/5", "3/5", "2/5", "1/5", "0/5"],
  reflex: ["0", "1+", "2+", "3+", "4+"],
};

const VALID_SIDES = new Set<string>(["left", "right", "bilateral"]);

function entryKey(itemId: string, side: NeuroSide): string {
  return `${itemId}:${side}`;
}

function pillClass(selected: boolean): string {
  const base =
    "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-default";
  if (!selected) {
    return `${base} border-gray-200 bg-white text-gray-500 hover:bg-gray-50`;
  }
  return `${base} border-teal-600 bg-teal-600 text-white`;
}

function layoutToggleClass(active: boolean): string {
  const base =
    "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-default";
  if (!active) {
    return `${base} border-gray-200 bg-white text-gray-500 hover:bg-gray-50`;
  }
  return `${base} border-teal-600 bg-teal-50 text-teal-800`;
}

function optionsForCategory(category: string): string[] {
  return RESULT_OPTIONS_BY_CATEGORY[category] ?? [];
}

function regionKey(category: string, region: string): string {
  return `${category}::${region}`;
}

function countRecordedEntries(entries: Record<string, Entry>): number {
  return Object.values(entries).filter((e) => e.result.trim() !== "").length;
}

export function NeuroExamSection({
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
  const [catalog, setCatalog] = useState<CatalogCategory[] | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savedCount, setSavedCount] = useState(0);
  const [sideLayout, setSideLayout] = useState<Record<string, SideLayout>>({});
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSavedResults = useCallback(async () => {
    if (!noteId || !clinicId) return;
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/neuro-exam?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { results?: SavedResultRow[] };
      const rows = Array.isArray(json.results) ? json.results : [];
      const next: Record<string, Entry> = {};
      const keys = new Set<string>();
      const layouts: Record<string, SideLayout> = {};
      const itemSides: Record<string, Set<NeuroSide>> = {};

      for (const row of rows) {
        const itemId = String(row.item_id ?? "").trim();
        const side = String(row.side ?? "").trim().toLowerCase();
        if (!itemId || !VALID_SIDES.has(side)) continue;
        const key = entryKey(itemId, side as NeuroSide);
        next[key] = {
          result: String(row.result ?? "").trim(),
          notes: String(row.clinician_notes ?? ""),
        };
        keys.add(key);
        if (!itemSides[itemId]) itemSides[itemId] = new Set();
        itemSides[itemId].add(side as NeuroSide);
      }

      for (const [itemId, sides] of Object.entries(itemSides)) {
        if (sides.has("bilateral")) {
          layouts[itemId] = "bilateral";
        } else {
          layouts[itemId] = "split";
        }
      }

      setEntries(next);
      setSavedKeys(keys);
      setSavedCount(countRecordedEntries(next));
      setSideLayout((prev) => ({ ...prev, ...layouts }));
    } catch {
      /* badge is non-critical */
    }
  }, [noteId, clinicId]);

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
      const res = await fetch(`${API_BASE}/api/neuro-exam-items`, { headers });
      if (!res.ok) {
        setError("Could not load the neuro exam library.");
        return;
      }
      const json = (await res.json()) as { categories?: CatalogCategory[] };
      setCatalog(Array.isArray(json.categories) ? json.categories : []);
      await loadSavedResults();
    } catch {
      setError("Could not load the neuro exam library.");
    } finally {
      setLoading(false);
    }
  }

  function getLayout(itemId: string): SideLayout {
    return sideLayout[itemId] ?? "split";
  }

  function setLayout(itemId: string, layout: SideLayout) {
    if (readOnly) return;
    const current = getLayout(itemId);
    if (current === layout) return;

    setSideLayout((prev) => ({ ...prev, [itemId]: layout }));

    const abandoned: NeuroSide[] =
      layout === "bilateral" ? ["left", "right"] : ["bilateral"];

    setEntries((prev) => {
      const next = { ...prev };
      for (const side of abandoned) {
        const key = entryKey(itemId, side);
        if (prev[key] !== undefined || savedKeys.has(key)) {
          next[key] = { result: "", notes: "" };
        }
      }
      return next;
    });
  }

  function setResult(itemId: string, side: NeuroSide, result: string) {
    if (readOnly) return;
    const key = entryKey(itemId, side);
    setEntries((prev) => ({
      ...prev,
      [key]: { result, notes: prev[key]?.notes ?? "" },
    }));
  }

  function setNotes(itemId: string, side: NeuroSide, notes: string) {
    if (readOnly) return;
    const key = entryKey(itemId, side);
    setEntries((prev) => ({
      ...prev,
      [key]: { result: prev[key]?.result ?? "", notes },
    }));
  }

  function getEntry(itemId: string, side: NeuroSide): Entry {
    return entries[entryKey(itemId, side)] ?? { result: "", notes: "" };
  }

  async function handleSave() {
    if (!noteId || !clinicId || readOnly) return;
    const payload: {
      item_id: string;
      side: NeuroSide;
      result: string | null;
      clinician_notes: string | null;
    }[] = [];

    for (const [key, entry] of Object.entries(entries)) {
      const sep = key.lastIndexOf(":");
      if (sep <= 0) continue;
      const itemId = key.slice(0, sep);
      const side = key.slice(sep + 1) as NeuroSide;
      if (!VALID_SIDES.has(side)) continue;
      const hasResult = entry.result.trim() !== "";
      if (!hasResult && !savedKeys.has(key)) continue;
      payload.push({
        item_id: itemId,
        side,
        result: hasResult ? entry.result.trim() : null,
        clinician_notes: entry.notes.trim() || null,
      });
    }

    setSaving(true);
    setError(null);
    try {
      const headers = await apiAuthHeaders();
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/neuro-exam?clinic_id=${encodeURIComponent(clinicId)}`,
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
      setSavedKeys(new Set(payload.map((p) => entryKey(p.item_id, p.side))));
      setSavedCount(
        payload.filter((p) => (p.result ?? "").trim() !== "").length,
      );
      onSaved?.("Neuro exam saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(category: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleRegion(category: string, region: string) {
    const key = regionKey(category, region);
    setOpenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderSideRow(
    itemId: string,
    side: NeuroSide,
    category: string,
    label: string,
  ) {
    const entry = getEntry(itemId, side);
    const options = optionsForCategory(category);
    const hasResult = entry.result.trim() !== "";

    return (
      <div key={side} className="mt-2 rounded-lg bg-gray-50/80 px-3 py-2">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={readOnly}
              onClick={() => setResult(itemId, side, option)}
              className={pillClass(entry.result === option)}
            >
              {option}
            </button>
          ))}
        </div>
        {hasResult ? (
          <input
            type="text"
            value={entry.notes}
            readOnly={readOnly}
            onChange={(e) => setNotes(itemId, side, e.target.value)}
            placeholder="Notes..."
            className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:outline-none read-only:bg-gray-50"
          />
        ) : null}
      </div>
    );
  }

  function renderItem(item: CatalogItem, category: string) {
    const layout = getLayout(item.id);

    return (
      <div key={item.id} className="rounded-lg border border-gray-100 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-gray-800">{item.name}</span>
          {!readOnly ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setLayout(item.id, "split")}
                className={layoutToggleClass(layout === "split")}
              >
                L / R
              </button>
              <button
                type="button"
                onClick={() => setLayout(item.id, "bilateral")}
                className={layoutToggleClass(layout === "bilateral")}
              >
                Bilateral
              </button>
            </div>
          ) : null}
        </div>
        {layout === "split" ? (
          <>
            {renderSideRow(item.id, "left", category, "Left")}
            {renderSideRow(item.id, "right", category, "Right")}
          </>
        ) : (
          renderSideRow(item.id, "bilateral", category, "Bilateral")
        )}
      </div>
    );
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
          Neuro Exam
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
              Save the note as a draft first to record neuro exam findings.
            </p>
          ) : null}

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading neuro exam library…
            </p>
          ) : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {catalog ? (
            <div className="space-y-2">
              {catalog.map((cat) => {
                const catOpen = openCategories.has(cat.category);
                const catCount = cat.regions.reduce(
                  (acc, reg) =>
                    acc +
                    reg.items.reduce((iacc, item) => {
                      const layout = getLayout(item.id);
                      if (layout === "bilateral") {
                        return (
                          iacc +
                          (getEntry(item.id, "bilateral").result.trim() !== ""
                            ? 1
                            : 0)
                        );
                      }
                      let n = 0;
                      if (getEntry(item.id, "left").result.trim() !== "") n += 1;
                      if (getEntry(item.id, "right").result.trim() !== "")
                        n += 1;
                      return iacc + n;
                    }, 0),
                  0,
                );
                return (
                  <div
                    key={cat.category}
                    className="rounded-lg border border-gray-100"
                  >
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat.category)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                      aria-expanded={catOpen}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium capitalize text-gray-800">
                        {catOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                        )}
                        {cat.category}
                      </span>
                      {catCount > 0 ? (
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                          {catCount}
                        </span>
                      ) : null}
                    </button>

                    {catOpen ? (
                      <div className="space-y-2 border-t border-gray-100 px-3 py-3">
                        {cat.regions.map((reg) => {
                          const rKey = regionKey(cat.category, reg.region);
                          const regOpen = openRegions.has(rKey);
                          const regCount = reg.items.reduce((acc, item) => {
                            const layout = getLayout(item.id);
                            if (layout === "bilateral") {
                              return (
                                acc +
                                (getEntry(item.id, "bilateral").result.trim() !==
                                ""
                                  ? 1
                                  : 0)
                              );
                            }
                            let n = 0;
                            if (getEntry(item.id, "left").result.trim() !== "")
                              n += 1;
                            if (getEntry(item.id, "right").result.trim() !== "")
                              n += 1;
                            return acc + n;
                          }, 0);
                          return (
                            <div
                              key={rKey}
                              className="rounded-lg border border-gray-100"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  toggleRegion(cat.category, reg.region)
                                }
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                                aria-expanded={regOpen}
                              >
                                <span className="flex items-center gap-2 text-sm font-medium capitalize text-gray-800">
                                  {regOpen ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                                  )}
                                  {reg.region}
                                </span>
                                {regCount > 0 ? (
                                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                                    {regCount}
                                  </span>
                                ) : null}
                              </button>

                              {regOpen ? (
                                <div className="space-y-2 border-t border-gray-100 px-3 py-3">
                                  {reg.items.map((item) =>
                                    renderItem(item, cat.category),
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
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
                {saving ? "Saving…" : "Save Neuro Exam"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

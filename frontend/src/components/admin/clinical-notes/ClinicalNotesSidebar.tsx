"use client";

import { DS_INPUT, DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import {
  SidebarFilters,
  defaultSidebarFilters,
} from "@/components/admin/clinical-notes/clinicalNotesTypes";

type ClinicianOption = { id: string; name: string };

type ClinicalNotesSidebarProps = {
  filters: SidebarFilters;
  onChange: (filters: SidebarFilters) => void;
  clinicians: ClinicianOption[];
};

const NOTE_TYPE_OPTIONS = [
  { value: "daily_note", label: "Daily Note" },
  { value: "progress_note", label: "Progress Note" },
  { value: "initial_evaluation", label: "Initial Evaluation" },
  { value: "re_evaluation", label: "Re-Evaluation" },
  { value: "discharge_note", label: "Discharge Summary" },
  { value: "other", label: "Other" },
];

export default function ClinicalNotesSidebar({
  filters,
  onChange,
  clinicians,
}: ClinicalNotesSidebarProps) {
  function toggleNoteType(value: string) {
    const allSelected = filters.noteTypes.length === 0;
    if (value === "all") {
      onChange({ ...filters, noteTypes: [] });
      return;
    }
    const set = new Set(filters.noteTypes);
    if (allSelected) {
      onChange({ ...filters, noteTypes: [value] });
      return;
    }
    if (set.has(value)) set.delete(value);
    else set.add(value);
    onChange({ ...filters, noteTypes: Array.from(set) });
  }

  return (
    <aside className="sticky top-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-semibold text-gray-900">Quick Filters</h3>

      <div className="mt-4 space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Date Range
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
              className={DS_INPUT}
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
              className={DS_INPUT}
            />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Note Type
          </p>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filters.noteTypes.length === 0}
                onChange={() => toggleNoteType("all")}
              />
              All Types
            </label>
            {NOTE_TYPE_OPTIONS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={
                    filters.noteTypes.length === 0 ||
                    filters.noteTypes.includes(o.value)
                  }
                  onChange={() => toggleNoteType(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Provider
          </p>
          <select
            value={filters.clinicianId}
            onChange={(e) => onChange({ ...filters, clinicianId: e.target.value })}
            className={DS_INPUT}
          >
            <option value="">All Providers</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            AI Status
          </p>
          <select
            value={filters.aiStatus}
            onChange={(e) => onChange({ ...filters, aiStatus: e.target.value })}
            className={DS_INPUT}
          >
            <option value="">All AI Statuses</option>
            <option value="generated">AI Generated</option>
            <option value="not_generated">Not Generated</option>
          </select>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Review Status
          </p>
          <select
            value={filters.reviewStatus}
            onChange={(e) => onChange({ ...filters, reviewStatus: e.target.value })}
            className={DS_INPUT}
          >
            <option value="">All Review Statuses</option>
            <option value="needs_review">Needs Review</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </div>

        <button
          type="button"
          className={`${DS_SECONDARY_BTN} w-full`}
          onClick={() => onChange(defaultSidebarFilters())}
        >
          Clear Filters
        </button>
      </div>
    </aside>
  );
}

"use client";

import { FilterTab, ClinicalNotesStats } from "@/components/admin/clinical-notes/clinicalNotesTypes";

type ClinicalNotesFilterTabsProps = {
  active: FilterTab;
  onChange: (tab: FilterTab) => void;
  counts?: ClinicalNotesStats["tab_counts"];
};

const TABS: { id: FilterTab; label: string; countKey: keyof ClinicalNotesStats["tab_counts"] }[] = [
  { id: "all", label: "All Notes", countKey: "all" },
  { id: "needs_review", label: "Needs Review", countKey: "needs_review" },
  { id: "ai_generated", label: "AI Generated", countKey: "ai_generated" },
  { id: "provider_signed", label: "Provider Signed", countKey: "provider_signed" },
  { id: "attorney_requested", label: "Attorney Requested", countKey: "attorney_requested" },
  { id: "completed", label: "Completed", countKey: "completed" },
];

export default function ClinicalNotesFilterTabs({
  active,
  onChange,
  counts,
}: ClinicalNotesFilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((t) => {
        const selected = active === t.id;
        const count = counts?.[t.countKey];
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={
              selected
                ? "rounded-full bg-[var(--color-primary,#16A34A)] px-4 py-1.5 text-sm font-medium text-white"
                : "rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-300"
            }
          >
            {t.label}
            {count !== undefined ? (
              <span className={selected ? " ml-1.5 opacity-90" : " ml-1.5 text-gray-400"}>
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

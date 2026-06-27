"use client";

import { ChevronRight } from "lucide-react";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  ClinicalNotesStats,
  noteTypeLabel,
} from "@/components/admin/clinical-notes/clinicalNotesTypes";

type ClinicalNotesInsightsProps = {
  stats: ClinicalNotesStats | null;
  onNewNote: () => void;
  readOnly?: boolean;
};

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 36;
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="text-emerald-500" aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
}

export default function ClinicalNotesInsights({
  stats,
  onNewNote,
  readOnly = false,
}: ClinicalNotesInsightsProps) {
  const insights = stats?.insights;

  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-4">
      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">AI Documentation Insights</h3>
        <p className="mt-3 text-3xl font-bold text-gray-900">
          {insights ? `${insights.ai_acceptance_rate}%` : "—"}
        </p>
        <p className="text-xs text-gray-500">AI Acceptance Rate</p>
        {insights ? (
          <div className="mt-3">
            <Sparkline values={insights.ai_daily_counts} />
          </div>
        ) : null}
        <div className="mt-4 space-y-2">
          {(insights?.top_ai_note_types ?? []).slice(0, 3).map((t) => (
            <div key={t.note_type}>
              <div className="flex justify-between text-xs text-gray-600">
                <span>{noteTypeLabel(t.note_type)}</span>
                <span>
                  {t.pct}% ({t.count})
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                <div
                  className="h-1.5 rounded-full bg-emerald-500"
                  style={{ width: `${t.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Review Turnaround Time</h3>
        <p className="mt-3 text-3xl font-bold text-gray-900">
          {insights ? `${insights.review_turnaround_days}` : "—"}
        </p>
        <p className="text-xs text-gray-500">Average days to review</p>
        {insights ? (
          <div className="mt-3">
            <Sparkline values={insights.ai_daily_counts.slice(-14)} />
          </div>
        ) : null}
      </div>

      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Signature Compliance</h3>
        <p className="mt-3 text-3xl font-bold text-gray-900">
          {insights ? `${insights.signature_compliance_48h_pct}%` : "—"}
        </p>
        <p className="text-xs text-gray-500">Signed within 48 hrs</p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-blue-500"
            style={{ width: `${insights?.signature_compliance_48h_pct ?? 0}%` }}
          />
        </div>
      </div>

      <div className={DS_CARD}>
        <h3 className="text-sm font-semibold text-gray-900">Common Actions</h3>
        <ul className="mt-3 divide-y divide-gray-100">
          {(
            [
              { label: "Create New Note", action: readOnly ? null : onNewNote },
              { label: "Note Templates", action: null as (() => void) | null },
              { label: "AI Settings", action: null },
              { label: "Note Audit Log", action: null },
            ] as const
          ).map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={item.action ?? undefined}
                disabled={!item.action}
                className="flex w-full items-center justify-between py-3 text-sm font-medium text-gray-800 hover:text-emerald-700 disabled:text-gray-400"
              >
                {item.label}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

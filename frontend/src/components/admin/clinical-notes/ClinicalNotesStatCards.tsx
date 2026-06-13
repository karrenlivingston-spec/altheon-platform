"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  ClipboardCheck,
  FileText,
  Scale,
  Sparkles,
} from "lucide-react";

import { ClinicalNotesStats } from "@/components/admin/clinical-notes/clinicalNotesTypes";

type ClinicalNotesStatCardsProps = {
  stats: ClinicalNotesStats | null;
  loading?: boolean;
};

function Trend({
  pct,
  invert,
}: {
  pct: number | null | undefined;
  invert?: boolean;
}) {
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-gray-400">— vs last month</span>;
  }
  if (pct === 0) {
    return <span className="text-xs text-gray-500">0% vs last month</span>;
  }
  const up = pct > 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        good ? "text-green-600" : "text-red-600"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(pct)}% vs last month
    </span>
  );
}

function StatCard({
  icon: Icon,
  iconBg,
  value,
  label,
  sub,
  trend,
  invertTrend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  value: string;
  label: string;
  sub?: string;
  trend?: number | null;
  invertTrend?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
          {sub ? <p className="mt-0.5 text-xs text-gray-500">{sub}</p> : null}
          <div className="mt-2">
            <Trend pct={trend} invert={invertTrend} />
          </div>
        </div>
        <div className={`rounded-lg p-2.5 ${iconBg}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export default function ClinicalNotesStatCards({
  stats,
  loading,
}: ClinicalNotesStatCardsProps) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <StatCard
        icon={FileText}
        iconBg="bg-emerald-50 text-emerald-700"
        value={String(stats.total_notes)}
        label="Total Notes"
        trend={stats.trends.total}
      />
      <StatCard
        icon={Bot}
        iconBg="bg-sky-50 text-sky-700"
        value={String(stats.ai_generated)}
        label="AI Generated"
        sub={`${stats.ai_generated_pct}% of total`}
        trend={stats.trends.ai_generated}
      />
      <StatCard
        icon={Sparkles}
        iconBg="bg-amber-50 text-amber-700"
        value={String(stats.needs_review)}
        label="Needs Review"
        trend={stats.trends.needs_review}
        invertTrend
      />
      <StatCard
        icon={ClipboardCheck}
        iconBg="bg-green-50 text-green-700"
        value={String(stats.provider_signed)}
        label="Provider Signed"
        sub={`${stats.provider_signed_pct}% of total`}
        trend={stats.trends.provider_signed}
      />
      <StatCard
        icon={Scale}
        iconBg="bg-violet-50 text-violet-700"
        value={String(stats.attorney_requested)}
        label="Attorney Requested"
        trend={stats.trends.attorney_requested}
      />
    </div>
  );
}

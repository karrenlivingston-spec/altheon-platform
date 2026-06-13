"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  FileText,
  Receipt,
  TrendingUp,
} from "lucide-react";

import {
  BillingDashboardData,
  formatUsdFromCents,
} from "@/components/admin/billing/billingTypes";

type BillingMetricsProps = {
  metrics?: BillingDashboardData["metrics"];
  loading?: boolean;
};

function Trend({ pct }: { pct: number }) {
  if (pct === 0) {
    return <span className="text-xs text-gray-500">0% vs last month</span>;
  }
  const up = pct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-green-600" : "text-red-600"
      }`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(pct)}% vs last month
    </span>
  );
}

function MetricCard({
  icon: Icon,
  value,
  label,
  trend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  trend?: number;
}) {
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Icon className="absolute right-4 top-4 h-5 w-5 text-gray-300" aria-hidden />
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      {trend !== undefined ? (
        <div className="mt-1">
          <Trend pct={trend} />
        </div>
      ) : null}
    </div>
  );
}

export default function BillingMetrics({ metrics, loading }: BillingMetricsProps) {
  if (loading || !metrics) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <MetricCard
        icon={Receipt}
        value={formatUsdFromCents(metrics.total_billed_mtd_cents)}
        label="Total Billed (MTD)"
        trend={metrics.billed_trend_pct}
      />
      <MetricCard
        icon={DollarSign}
        value={formatUsdFromCents(metrics.collected_mtd_cents)}
        label="Collected (MTD)"
        trend={metrics.collected_trend_pct}
      />
      <MetricCard
        icon={TrendingUp}
        value={formatUsdFromCents(metrics.outstanding_cents)}
        label="Outstanding"
      />
      <MetricCard
        icon={FileText}
        value={String(metrics.claims_submitted)}
        label="Claims Submitted"
      />
      <MetricCard
        icon={AlertTriangle}
        value={String(metrics.claims_denied)}
        label="Claims Denied"
      />
      <MetricCard
        icon={DollarSign}
        value={formatUsdFromCents(metrics.avg_collection_cents)}
        label="Avg Collection/Claim"
      />
    </div>
  );
}

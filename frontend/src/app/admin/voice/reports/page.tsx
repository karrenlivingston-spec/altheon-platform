"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  OutcomesReportResponse,
  defaultLastNDaysRange,
  formatAvgDurationSeconds,
  formatChartDate,
  toYmd,
} from "@/components/admin/voice/voiceCallTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const TEAL = "#0D9488";
const INDIGO = "#6366f1";

type ReportPeriod = 7 | 30 | 90;

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 7, label: "Last 7 Days" },
  { value: 30, label: "Last 30 Days" },
  { value: 90, label: "Last 90 Days" },
];

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function rateColorClass(rate: number): string {
  if (rate >= 50) return "text-green-700";
  if (rate >= 25) return "text-amber-700";
  return "text-red-600";
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200 ${className}`} />;
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className={DS_CARD}>
      <p className={`text-2xl font-bold text-gray-900 ${valueClass ?? ""}`}>{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
    </div>
  );
}

export default function VoiceReportsPage() {
  const router = useRouter();
  const { clinicId, role, loading: clinicLoading } = useClinic();
  const isPlatformAdmin =
    role === "super_admin" || role === "platform_admin";

  const [periodDays, setPeriodDays] = useState<ReportPeriod>(30);
  const [dateFrom, setDateFrom] = useState(defaultLastNDaysRange(30).from);
  const [dateTo, setDateTo] = useState(defaultLastNDaysRange(30).to);
  const [report, setReport] = useState<OutcomesReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const applyPeriod = useCallback((days: ReportPeriod) => {
    const range = defaultLastNDaysRange(days);
    setPeriodDays(days);
    setDateFrom(range.from);
    setDateTo(range.to);
  }, []);

  const loadReport = useCallback(async () => {
    if (!clinicId || !isPlatformAdmin) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await fetch(
        `${API_BASE}/voice/clinic/${encodeURIComponent(clinicId)}/reports/outcomes?${params}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) throw new Error(`Outcomes report failed (${res.status})`);
      const json = (await res.json()) as OutcomesReportResponse;
      setReport(json);
    } catch (err) {
      console.error("Outcomes report load failed:", err);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [clinicId, dateFrom, dateTo, isPlatformAdmin]);

  useEffect(() => {
    if (!clinicLoading && !isPlatformAdmin) {
      router.replace("/admin/voice");
    }
  }, [clinicLoading, isPlatformAdmin, router]);

  useEffect(() => {
    if (!isPlatformAdmin || !clinicId) return;
    void loadReport();
  }, [clinicId, isPlatformAdmin, loadReport]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const chartData = (report?.daily_trend ?? []).map((row) => ({
    date: row.date,
    label: formatChartDate(row.date),
    total: row.total,
    booked: row.booked,
  }));

  const hasData = (report?.total_calls ?? 0) > 0;

  if (clinicLoading || !isPlatformAdmin) {
    return (
      <div className={DS_PAGE_ROOT}>
        <SkeletonBlock className="h-8 w-48" />
      </div>
    );
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-4">
        <Link
          href="/admin/voice"
          className="text-sm font-medium text-[#0D9488] hover:text-[#0f766e]"
        >
          ← Voice Agent
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Call Outcomes Report</h1>
          <p className={DS_PAGE_SUBTITLE}>Conversion and outcome analytics</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={`${DS_INPUT} w-auto`}
            aria-label="From date"
          />
          <span className="text-sm text-gray-400">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            max={toYmd(new Date())}
            className={`${DS_INPUT} w-auto`}
            aria-label="To date"
          />
          <button
            type="button"
            onClick={() => setToast("Export coming soon")}
            className={`${DS_PRIMARY_BTN} inline-flex items-center gap-2`}
            style={{ backgroundColor: TEAL }}
          >
            <Download className="h-4 w-4" aria-hidden />
            Export PDF
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
      ) : hasData && report ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Calls" value={String(report.total_calls)} />
          <StatCard
            label="Booking Rate"
            value={`${report.booking_rate.toFixed(1)}%`}
            valueClass={rateColorClass(report.booking_rate)}
          />
          <StatCard
            label="Intake Completion Rate"
            value={`${report.intake_completion_rate.toFixed(1)}%`}
          />
          <StatCard
            label="Avg Call Duration"
            value={formatAvgDurationSeconds(report.avg_duration_seconds)}
          />
        </div>
      ) : (
        <div className={`${DS_CARD} mb-8 py-12 text-center text-sm text-gray-500`}>
          No call data for this period
        </div>
      )}

      <div className={`${DS_CARD} mb-8`}>
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Outcomes breakdown</h2>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-10" />
            ))}
          </div>
        ) : !hasData || !report?.outcomes.length ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No call data for this period
          </p>
        ) : (
          <div className={DS_TABLE_WRAP}>
            <table className="min-w-full">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Outcome</th>
                  <th className={DS_TH}>Count</th>
                  <th className={DS_TH}>Percentage</th>
                  <th className={DS_TH}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {report.outcomes.map((row) => (
                  <tr key={row.outcome} className={DS_TR}>
                    <td className={`${DS_TD_PRIMARY} capitalize`}>{row.outcome}</td>
                    <td className={DS_TD_PRIMARY}>{row.count}</td>
                    <td className={DS_TD_PRIMARY}>{row.percentage.toFixed(1)}%</td>
                    <td className={DS_TD_PRIMARY}>
                      <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, row.percentage)}%`,
                            backgroundColor: TEAL,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={DS_CARD}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Daily trend</h2>
          <div className="flex flex-wrap gap-2">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => applyPeriod(opt.value)}
                className={[
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  periodDays === opt.value
                    ? "bg-[#0D9488] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <SkeletonBlock className="h-64 w-full" />
        ) : chartData.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">
            No call data for this period
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={TEAL} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={TEAL} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="bookedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={INDIGO} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={INDIGO} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                domain={[0, "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#6b7280", fontSize: 11 }}
                width={32}
              />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area
                type="monotone"
                dataKey="total"
                name="Total Calls"
                stroke={TEAL}
                fill="url(#totalFill)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="booked"
                name="Booked"
                stroke={INDIGO}
                fill="url(#bookedFill)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {toast ? (
        <div
          className="fixed right-4 bottom-4 z-[70] rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg"
          style={{ backgroundColor: TEAL }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

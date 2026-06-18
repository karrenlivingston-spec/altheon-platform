"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_PAGE_ROOT,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
  activeInactiveBadgeClass,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const TEAL = "#0D9488";
const AMBER = "#F59E0B";

type TrendPeriod = "week" | "month" | "quarter" | "year";

type AnalyticsClinic = {
  id: string;
  name: string;
  is_active: boolean;
  total_patients: number;
  appointments_this_month: number;
  appointments_last_month: number;
  revenue_this_month: number;
  revenue_last_month: number;
  collection_rate: number;
  active_clinicians: number;
};

type AnalyticsTotals = {
  total_patients: number;
  appointments_this_month: number;
  appointments_last_month: number;
  revenue_this_month: number;
  revenue_last_month: number;
  collection_rate: number;
  active_clinicians: number;
};

type TrendPoint = {
  date: string;
  appointments: number;
  revenue: number;
};

type ClinicianRow = {
  clinician_name: string;
  appointments_this_month: number;
  notes_signed: number;
  avg_per_day: number;
};

type OverviewResponse = {
  clinics: AnalyticsClinic[];
  totals: AnalyticsTotals;
};

type ReferralSourceRow = {
  referral_source: string | null;
  count: number;
  label: string;
};

const PERIOD_OPTIONS: { value: TrendPeriod; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyPrecise(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function momPct(thisMonth: number, lastMonth: number): number {
  if (lastMonth <= 0) return thisMonth > 0 ? 100 : 0;
  return Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10;
}

function MomChip({ thisMonth, lastMonth }: { thisMonth: number; lastMonth: number }) {
  const pct = momPct(thisMonth, lastMonth);
  if (pct > 0) {
    return (
      <span className="ml-1.5 inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
        +{pct}%
      </span>
    );
  }
  if (pct < 0) {
    return (
      <span className="ml-1.5 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
        {pct}%
      </span>
    );
  }
  return (
    <span className="ml-1.5 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
      0%
    </span>
  );
}

function collectionRateClass(rate: number): string {
  if (rate >= 80) return "text-green-700";
  if (rate >= 60) return "text-amber-700";
  return "text-red-600";
}

function formatChartDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200 ${className}`} />;
}

function PlatformStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
    </div>
  );
}

function PeriodPills({
  value,
  onChange,
}: {
  value: TrendPeriod;
  onChange: (p: TrendPeriod) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-[#0D9488] text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ClinicTrendChart({
  clinicId,
  period,
}: {
  clinicId: string;
  period: TrendPeriod;
}) {
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/analytics/clinic/${encodeURIComponent(clinicId)}/trend?period=${period}`,
          { headers: await authHeaders() },
        );
        if (!res.ok) throw new Error("Failed to load trend");
        const json = (await res.json()) as TrendPoint[];
        if (!cancelled) setData(Array.isArray(json) ? json : []);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId, period]);

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#0D9488]" aria-hidden />
        <span className="sr-only">Loading chart</span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-gray-500">
        No trend data for this period.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis
          dataKey="date"
          tickFormatter={formatChartDate}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#9ca3af", fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="appts"
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fill: TEAL, fontSize: 11 }}
          width={32}
        />
        <YAxis
          yAxisId="rev"
          orientation="right"
          axisLine={false}
          tickLine={false}
          tick={{ fill: AMBER, fontSize: 11 }}
          width={48}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload as TrendPoint;
            return (
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
                <p className="font-medium text-gray-900">{formatChartDate(row.date)}</p>
                <p className="text-[#0D9488]">Appointments: {row.appointments}</p>
                <p className="text-amber-600">
                  Revenue: {formatCurrencyPrecise(row.revenue)}
                </p>
              </div>
            );
          }}
        />
        <Line
          yAxisId="appts"
          type="monotone"
          dataKey="appointments"
          stroke={TEAL}
          strokeWidth={2}
          dot={false}
          name="Appointments"
        />
        <Line
          yAxisId="rev"
          type="monotone"
          dataKey="revenue"
          stroke={AMBER}
          strokeWidth={2}
          dot={false}
          name="Revenue"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ClinicianTable({ clinicId }: { clinicId: string }) {
  const [rows, setRows] = useState<ClinicianRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/analytics/clinic/${encodeURIComponent(clinicId)}/clinicians`,
          { headers: await authHeaders() },
        );
        if (!res.ok) throw new Error("Failed to load clinicians");
        const json = (await res.json()) as ClinicianRow[];
        if (!cancelled) setRows(Array.isArray(json) ? json : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[#0D9488]" aria-hidden />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">
        No clinician data available.
      </p>
    );
  }

  return (
    <div className={DS_TABLE_WRAP}>
      <table className="min-w-full">
        <thead className={DS_TABLE_HEAD}>
          <tr>
            <th className={DS_TH}>Clinician</th>
            <th className={DS_TH}>Appts This Month</th>
            <th className={DS_TH}>Notes Signed</th>
            <th className={DS_TH}>Avg/Day</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.clinician_name} className={DS_TR}>
              <td className={DS_TD_PRIMARY}>{row.clinician_name}</td>
              <td className={DS_TD_PRIMARY}>{row.appointments_this_month}</td>
              <td className={DS_TD_PRIMARY}>{row.notes_signed}</td>
              <td className={DS_TD_PRIMARY}>{row.avg_per_day.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClinicDetailPanel({ clinicId }: { clinicId: string }) {
  const [period, setPeriod] = useState<TrendPeriod>("month");

  return (
    <div className="border-t border-gray-100 bg-gray-50/80 px-5 py-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Performance trend</h4>
        <PeriodPills value={period} onChange={setPeriod} />
      </div>
      <ClinicTrendChart clinicId={clinicId} period={period} />
      <h4 className="mb-3 mt-6 text-sm font-semibold text-gray-900">
        Clinician productivity
      </h4>
      <ClinicianTable clinicId={clinicId} />
    </div>
  );
}

function ExportPdfPopover({
  clinics,
}: {
  clinics: AnalyticsClinic[];
}) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<TrendPeriod>("month");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(clinics.map((c) => c.id)));
    setError(null);
  }, [open, clinics]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const clinicIds = Array.from(selected);
      const res = await fetch(`${API_BASE}/analytics/report/pdf`, {
        method: "POST",
        headers: await authHeaders(true),
        body: JSON.stringify({
          clinic_ids: clinicIds.length === clinics.length ? [] : clinicIds,
          period,
        }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        throw new Error(
          errJson?.error || errJson?.detail || "Could not generate report",
        );
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/i.exec(disposition);
      const date = new Date().toISOString().slice(0, 10);
      const filename = match?.[1] ?? `altheon_analytics_${date}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate report");
    } finally {
      setBusy(false);
    }
  }

  function toggleClinic(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/25"
      >
        <Download className="h-4 w-4" aria-hidden />
        Export PDF
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
          <p className="mb-3 text-sm font-semibold text-gray-900">Export analytics report</p>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Clinics
          </p>
          <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
            {clinics.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggleClinic(c.id)}
                  className="rounded border-gray-300 text-[#0D9488] focus:ring-[#0D9488]"
                />
                <span className="truncate">{c.name}</span>
              </label>
            ))}
          </div>
          <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">
            Period
          </p>
          <PeriodPills value={period} onChange={setPeriod} />
          {error ? (
            <p className="mt-3 text-xs text-red-600">{error}</p>
          ) : null}
          <button
            type="button"
            disabled={busy || selected.size === 0}
            onClick={() => void handleGenerate()}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#0D9488] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f766e] disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Generating…
              </>
            ) : (
              "Generate Report"
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ClinicAnalyticsCard({ clinic }: { clinic: AnalyticsClinic }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-gray-900">{clinic.name}</h3>
          <span className={activeInactiveBadgeClass(clinic.is_active)}>
            {clinic.is_active ? "Active" : "Inactive"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <p className="text-xs text-gray-500">Total Patients</p>
            <p className="font-semibold text-gray-900">{clinic.total_patients}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Appts This Month</p>
            <p className="font-semibold text-gray-900">
              {clinic.appointments_this_month}
              <MomChip
                thisMonth={clinic.appointments_this_month}
                lastMonth={clinic.appointments_last_month}
              />
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Revenue This Month</p>
            <p className="font-semibold text-gray-900">
              {formatCurrency(clinic.revenue_this_month)}
              <MomChip
                thisMonth={clinic.revenue_this_month}
                lastMonth={clinic.revenue_last_month}
              />
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Collection Rate</p>
            <p
              className={`font-semibold ${collectionRateClass(clinic.collection_rate)}`}
            >
              {clinic.collection_rate.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Active Clinicians</p>
            <p className="font-semibold text-gray-900">{clinic.active_clinicians}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-5 flex w-full items-center justify-center gap-1 border-t border-gray-100 pt-4 text-sm font-medium text-[#0D9488] hover:text-[#0f766e]"
        >
          View Details
          {expanded ? (
            <ChevronUp className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden />
          )}
        </button>
      </div>
      {expanded ? <ClinicDetailPanel clinicId={clinic.id} /> : null}
    </div>
  );
}

function ReferralSourcesSection({ clinicId }: { clinicId: string }) {
  const [rows, setRows] = useState<ReferralSourceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReferralSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/patients/referral-source/summary?clinic_id=${encodeURIComponent(clinicId)}&platform_wide=true`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const json: unknown = await res.json();
      setRows(Array.isArray(json) ? (json as ReferralSourceRow[]) : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    if (!clinicId) return;
    void loadReferralSummary();
  }, [clinicId, loadReferralSummary]);

  const chartData = [...rows]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ label: r.label, count: r.count }));

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">Referral Sources</h2>
      <p className="mt-1 text-sm text-gray-500">How patients are finding your clinic</p>

      {loading ? (
        <SkeletonBlock className="mt-6 h-72" />
      ) : chartData.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-6 py-12 text-center text-sm text-gray-500">
          No referral data yet. Referral sources will appear here as patients are
          added with intake information.
        </div>
      ) : (
        <div className="mt-6 h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 48, left: 8, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="label"
                width={120}
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                formatter={(value) => [Number(value ?? 0), "Patients"]}
                contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
              />
              <Bar dataKey="count" fill={TEAL} radius={[0, 4, 4, 0]} maxBarSize={28}>
                <LabelList
                  dataKey="count"
                  position="right"
                  style={{ fill: "#374151", fontSize: 12, fontWeight: 500 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const { role, clinicId, loading: clinicLoading } = useClinic();
  const isPlatformAdmin =
    !clinicLoading && (role === "super_admin" || role === "platform_admin");

  const [clinics, setClinics] = useState<AnalyticsClinic[]>([]);
  const [totals, setTotals] = useState<AnalyticsTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/analytics/overview`, {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/admin");
          return;
        }
        throw new Error(`Could not load analytics (${res.status})`);
      }
      const json = (await res.json()) as OverviewResponse;
      setClinics(Array.isArray(json.clinics) ? json.clinics : []);
      setTotals(json.totals ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load analytics");
      setClinics([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!clinicLoading && role !== "super_admin" && role !== "platform_admin") {
      router.replace("/admin");
    }
  }, [clinicLoading, role, router]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    void loadOverview();
  }, [isPlatformAdmin, loadOverview]);

  if (clinicLoading || (!isPlatformAdmin && role !== "super_admin" && role !== "platform_admin")) {
    return (
      <div className={DS_PAGE_ROOT}>
        <SkeletonBlock className="mb-6 h-28" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="-mx-8 mb-8 bg-[#0D9488] px-8 py-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
            <p className="mt-1 text-sm text-teal-50">
              Platform-wide performance across all clinics.
            </p>
          </div>
          {!loading && clinics.length > 0 ? (
            <ExportPdfPopover clinics={clinics} />
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border-2 border-[#0D9488] bg-teal-50/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-teal-900">{error}</p>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="shrink-0 rounded-lg bg-[#0D9488] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f766e]"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-24" />
          ))}
        </div>
      ) : totals ? (
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PlatformStatCard label="Total Clinics" value={String(clinics.length)} />
          <PlatformStatCard
            label="Total Patients"
            value={String(totals.total_patients)}
          />
          <PlatformStatCard
            label="Appointments This Month"
            value={String(totals.appointments_this_month)}
          />
          <PlatformStatCard
            label="Platform Revenue This Month"
            value={formatCurrency(totals.revenue_this_month)}
          />
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-48" />
          ))}
        </div>
      ) : clinics.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {clinics.map((clinic) => (
            <ClinicAnalyticsCard key={clinic.id} clinic={clinic} />
          ))}
        </div>
      ) : !error ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          No clinic data available.
        </div>
      ) : null}

      {!loading && clinicId ? <ReferralSourcesSection clinicId={clinicId} /> : null}
    </div>
  );
}

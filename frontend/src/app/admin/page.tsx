"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  addDaysToYmd,
  formatTimeEastern,
  getEasternYMD,
} from "@/components/adminEastern";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";
const NY = "America/New_York";

const CLINICIAN_WEST_ID = "fb6fa0fc-78f3-48c0-818b-511ad7a8ee93";
const CLINICIAN_SHARPE_ID = "ee6eaa90-1f90-4af7-85a5-4ae78aea3df7";

const MUTED_BAR = "#86EFAC";

type PatientRow = {
  id?: string;
  first_name?: string;
  last_name?: string;
};

type AppointmentRow = {
  id: string;
  clinician_id: string;
  start_time: string;
  status: string;
  created_at?: string;
  patients?: { first_name?: string; last_name?: string } | null;
  treatment_types?: { name?: string } | null;
};

type BillingRecordRow = {
  id: string;
  date_of_service?: string;
  status?: string;
  total_billed_cents?: number | null;
  total_paid_cents?: number | null;
  amount_paid_cents?: number | null;
};

type VoiceConversationRow = {
  conversation_id?: string;
  start_time_unix_secs?: number;
  call_duration_secs?: number;
  message_count?: number;
  call_successful?: string;
  transcript_summary?: string | null;
  direction?: string | null;
};

function clinicianLabel(id: string): string {
  if (id === CLINICIAN_WEST_ID) return "Dr. West";
  if (id === CLINICIAN_SHARPE_ID) return "Dr. Sharpe";
  return id;
}

function clinicianRowAccentClass(id: string): string {
  if (id === CLINICIAN_WEST_ID) return "border-l-2 border-l-[#0EA5A4]";
  if (id === CLINICIAN_SHARPE_ID) return "border-l-2 border-l-[#7C3AED]";
  return "border-l-2 border-l-gray-300";
}

function patientName(row: AppointmentRow): string {
  const p = row.patients;
  if (!p) return "—";
  const fn = p.first_name ?? "";
  const ln = p.last_name ?? "";
  const s = `${fn} ${ln}`.trim();
  return s || "—";
}

function serviceName(row: AppointmentRow): string {
  return row.treatment_types?.name ?? "—";
}

function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

const VOICE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function countCallsLast7Days(convs: VoiceConversationRow[]): number {
  const cutoff = Date.now() - VOICE_LOOKBACK_MS;
  let n = 0;
  for (const c of convs) {
    const u = Number(c.start_time_unix_secs);
    if (!Number.isFinite(u)) continue;
    const ms = u * 1000;
    if (ms >= cutoff && ms <= Date.now()) n += 1;
  }
  return n;
}

function avgDurationSecondsAllCalls(convs: VoiceConversationRow[]): number | null {
  const nums = convs
    .map((c) => Number(c.call_duration_secs))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function formatAvgMinsSecs(avgSecs: number | null): string {
  if (avgSecs === null || !Number.isFinite(avgSecs)) return "—";
  const total = Math.max(0, Math.round(avgSecs));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s`;
}

function headerSubtitleEastern(now: Date): string {
  const line = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  return `West Palm Beach · ${line}`;
}

const FOCUS_NEXT_FALLBACK = "Next: Brandon West · Mon 10:30 AM";

function formatNextAppointmentLine(row: AppointmentRow | null): string {
  if (!row) return FOCUS_NEXT_FALLBACK;
  const d = new Date(row.start_time);
  if (Number.isNaN(d.getTime())) return FOCUS_NEXT_FALLBACK;
  const wk = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    weekday: "short",
  }).format(d);
  const tm = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `Next: ${patientName(row)} · ${wk} ${tm}`;
}

export default function AdminOverviewPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [billingRecords, setBillingRecords] = useState<BillingRecordRow[]>([]);
  const [openPiCasesCount, setOpenPiCasesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [focusCheckInBusy, setFocusCheckInBusy] = useState(false);
  const [ariaOnline, setAriaOnline] = useState<boolean | null>(null);
  const [voiceCalls7dDisplay, setVoiceCalls7dDisplay] = useState("—");
  const [voiceAvgDurationDisplay, setVoiceAvgDurationDisplay] = useState("—");

  const refetchAppointments = useCallback(async () => {
    try {
      const apRes = await fetch(
        `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
      );
      const apJson = apRes.ok ? await apRes.json() : [];
      setAppointments(Array.isArray(apJson) ? apJson : []);
    } catch {
      setAppointments([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchVoiceAgentData() {
      try {
        const [vsRes, vcRes] = await Promise.all([
          fetch(
            `${API_BASE}/voice-agent/status?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
          ),
          fetch(
            `${API_BASE}/voice-agent/conversations?clinic_id=${encodeURIComponent(CLINIC_ID)}&page_size=50`,
          ),
        ]);
        const statusJson = vsRes.ok
          ? ((await vsRes.json()) as { status?: string })
          : null;
        const convPayload = vcRes.ok
          ? ((await vcRes.json()) as { conversations?: VoiceConversationRow[] })
          : null;
        const convs = Array.isArray(convPayload?.conversations)
          ? convPayload.conversations
          : [];
        if (cancelled) return;
        const st = (statusJson?.status ?? "").toLowerCase();
        setAriaOnline(st === "online" ? true : st === "offline" ? false : null);
        const n7 = countCallsLast7Days(convs);
        setVoiceCalls7dDisplay(String(n7));
        const avg = avgDurationSecondsAllCalls(convs);
        setVoiceAvgDurationDisplay(formatAvgMinsSecs(avg));
      } catch {
        if (!cancelled) {
          setAriaOnline(null);
          setVoiceCalls7dDisplay("—");
          setVoiceAvgDurationDisplay("—");
        }
      }
    }

    async function fetchData(silent = false) {
      void fetchVoiceAgentData();

      if (!silent) {
        setLoading(true);
      }
      try {
        const [apRes, ptRes, brRes, piRes] = await Promise.all([
          fetch(
            `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
          ),
          fetch(`${API_BASE}/patients?clinic_id=${encodeURIComponent(CLINIC_ID)}`),
          fetch(
            `${API_BASE}/billing-records?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
          ),
          fetch(
            `${API_BASE}/pi-cases?clinic_id=${encodeURIComponent(CLINIC_ID)}&status=open`,
          ),
        ]);
        const apJson = apRes.ok ? await apRes.json() : [];
        const ptJson = ptRes.ok ? await ptRes.json() : [];
        const brJson = brRes.ok ? await brRes.json() : [];
        const piJson = piRes.ok ? await piRes.json() : [];
        if (!cancelled) {
          setAppointments(Array.isArray(apJson) ? apJson : []);
          setPatients(Array.isArray(ptJson) ? ptJson : []);
          setBillingRecords(Array.isArray(brJson) ? brJson : []);
          setOpenPiCasesCount(Array.isArray(piJson) ? piJson.length : 0);
        }
      } catch {
        if (!cancelled) {
          setAppointments([]);
          setPatients([]);
          setBillingRecords([]);
          setOpenPiCasesCount(0);
        }
      } finally {
        if (!cancelled && !silent) {
          setLoading(false);
        }
      }
    }

    void fetchData(false);

    const interval = setInterval(() => {
      void fetchData(true);
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const todayEasternYmd = useMemo(() => getEasternYMD(new Date()), []);

  const nextFocusAppointment = useMemo(() => {
    /* eslint-disable react-hooks/purity -- wall-clock comparison */
    const nowMs = Date.now();
    /* eslint-enable react-hooks/purity */
    const candidates = appointments.filter((a) => {
      if (String(a.status).toLowerCase() !== "scheduled") return false;
      if (getEasternYMD(new Date(a.start_time)) !== todayEasternYmd) return false;
      return new Date(a.start_time).getTime() > nowMs;
    });
    if (candidates.length === 0) return null;
    return [...candidates].sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
    )[0];
  }, [appointments, todayEasternYmd]);

  async function handleFocusCheckIn(appointmentId: string) {
    setFocusCheckInBusy(true);
    try {
      const res = await fetch(
        `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/status?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "checked_in" }),
        },
      );
      if (res.ok) {
        await refetchAppointments();
      }
    } finally {
      setFocusCheckInBusy(false);
    }
  }

  const todayAppointments = useMemo(() => {
    return appointments.filter((a) => {
      const ymd = getEasternYMD(new Date(a.start_time));
      return ymd === todayEasternYmd;
    });
  }, [appointments, todayEasternYmd]);

  const todayCount = todayAppointments.length;
  const patientCount = patients.length;

  const billingRecordsThisMonth = useMemo(() => {
    const ymd = getEasternYMD(new Date());
    const [yStr, mStr] = ymd.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const mi = m - 1;
    const lastDay = new Date(y, mi + 1, 0).getDate();
    const start = `${yStr}-${mStr}-01`;
    const end = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
    return billingRecords.filter((r) => {
      const raw = (r.date_of_service ?? "").trim();
      if (!raw) return false;
      const d = raw.slice(0, 10);
      return d >= start && d <= end;
    });
  }, [billingRecords]);

  const totalBilledThisMonthCents = useMemo(
    () =>
      billingRecordsThisMonth.reduce(
        (acc, r) => acc + (Number(r.total_billed_cents) || 0),
        0,
      ),
    [billingRecordsThisMonth],
  );

  const billingSummaryCounts = useMemo(() => {
    let draft = 0;
    let submitted = 0;
    let paid = 0;
    let deniedPartial = 0;
    for (const r of billingRecordsThisMonth) {
      const s = (r.status ?? "draft").toLowerCase();
      if (s === "draft") draft += 1;
      else if (s === "submitted") submitted += 1;
      else if (s === "paid") paid += 1;
      else if (s === "denied" || s === "partial") deniedPartial += 1;
    }
    return { draft, submitted, paid, deniedPartial };
  }, [billingRecordsThisMonth]);

  const totalOutstandingThisMonthCents = useMemo(
    () =>
      billingRecordsThisMonth
        .filter((r) => String(r.status ?? "").toLowerCase() !== "paid")
        .reduce(
          (acc, r) =>
            acc +
            (Number(r.total_billed_cents) || 0) -
            (Number(
              r.amount_paid_cents !== undefined && r.amount_paid_cents !== null
                ? r.amount_paid_cents
                : r.total_paid_cents,
            ) || 0),
          0,
        ),
    [billingRecordsThisMonth],
  );

  const upcomingAppointments = useMemo(() => {
    /* eslint-disable react-hooks/purity */
    const nowMs = Date.now();
    /* eslint-enable react-hooks/purity */
    const cancelledLike = new Set(["cancelled", "canceled"]);
    return [...appointments]
      .filter((a) => {
        const t = new Date(a.start_time).getTime();
        if (!Number.isFinite(t) || t < nowMs) return false;
        const st = String(a.status ?? "").toLowerCase();
        if (cancelledLike.has(st)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      )
      .slice(0, 14);
  }, [appointments]);

  const focusLine2 = useMemo(
    () => formatNextAppointmentLine(upcomingAppointments[0] ?? null),
    [upcomingAppointments],
  );

  const appointmentsLast7DaysChart = useMemo(() => {
    const todayY = getEasternYMD(new Date());
    const rows: { day: string; total: number; ymd: string }[] = [];
    for (let i = -6; i <= 0; i++) {
      const ymd = addDaysToYmd(todayY, i);
      const dayShort = new Intl.DateTimeFormat("en-US", {
        timeZone: NY,
        weekday: "short",
      }).format(
        new Date(
          Date.UTC(
            Number(ymd.slice(0, 4)),
            Number(ymd.slice(5, 7)) - 1,
            Number(ymd.slice(8, 10)),
            15,
            0,
            0,
          ),
        ),
      );
      let total = 0;
      for (const a of appointments) {
        if (getEasternYMD(new Date(a.start_time)) !== ymd) continue;
        total += 1;
      }
      rows.push({ day: dayShort, total, ymd });
    }
    return rows;
  }, [appointments]);

  const chartWeekInsight = useMemo(() => {
    const rows = appointmentsLast7DaysChart;
    if (rows.length === 0) return "";
    let max = -1;
    let day = "";
    for (const r of rows) {
      if (r.total > max) {
        max = r.total;
        day = r.day;
      }
    }
    if (max <= 0) return "No appointments in the last 7 days.";
    return `${day} had the highest volume this week`;
  }, [appointmentsLast7DaysChart]);

  const ariaLine =
    ariaOnline === true
      ? "Aria · Online"
      : ariaOnline === false
        ? "Aria · Offline"
        : "Aria · —";

  return (
    <div className="w-full bg-[#F8FAFC] pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
          <p className="mt-1 text-sm text-gray-500">
            {headerSubtitleEastern(new Date())}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm text-gray-500 sm:pt-1">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              ariaOnline === true
                ? "bg-[#16A34A]"
                : ariaOnline === false
                  ? "bg-gray-300"
                  : "bg-gray-300"
            }`}
            aria-hidden
          />
          <span>{ariaLine}</span>
        </div>
      </div>

      <section className="mt-8">
        {loading ? (
          <div className="rounded-xl border border-gray-200 border-l-4 border-l-[#16A34A] bg-gray-50 p-5">
            <p className="text-sm font-medium text-gray-900">
              Loading today&apos;s schedule…
            </p>
            <p className="mt-1 text-sm text-gray-500">Please wait.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 border-l-4 border-l-[#16A34A] bg-gray-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  No appointments remaining today
                </p>
                <p className="mt-1 text-sm text-gray-500">{focusLine2}</p>
              </div>
              {nextFocusAppointment ? (
                <button
                  type="button"
                  disabled={focusCheckInBusy}
                  onClick={() =>
                    void handleFocusCheckIn(nextFocusAppointment.id)
                  }
                  className="shrink-0 text-sm font-medium text-[#16A34A] hover:text-[#15803D] disabled:opacity-50"
                >
                  {focusCheckInBusy ? "Checking in…" : "Check in"}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <PrimaryMetricCard
          label="Today"
          value={loading ? "…" : String(todayCount)}
        />
        <PrimaryMetricCard
          label="Patients"
          value={loading ? "…" : String(patientCount)}
        />
        <PrimaryMetricCard label="Calls (7d)" value={voiceCalls7dDisplay} />
        <PrimaryMetricCard
          label="Revenue"
          value={
            loading ? "…" : formatUsdFromCents(totalBilledThisMonthCents)
          }
        />
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6">
        <SecondaryMetricCard
          label="Open PI cases"
          value={loading ? "…" : String(openPiCasesCount)}
        />
        <SecondaryMetricCard
          label="Avg call duration"
          value={voiceAvgDurationDisplay}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="min-w-0">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            Upcoming appointments
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : upcomingAppointments.length === 0 ? (
            <p className="text-sm text-gray-500">
              No upcoming appointments on the calendar.
            </p>
          ) : (
            <ul>
              {upcomingAppointments.map((row) => {
                const st = String(row.status ?? "").toLowerCase();
                const statusPositive =
                  st === "scheduled" ||
                  st === "confirmed" ||
                  st === "checked_in";
                return (
                  <li
                    key={row.id}
                    className={`flex items-center gap-4 border-b border-gray-100 py-4 pl-3 last:border-b-0 ${clinicianRowAccentClass(row.clinician_id)}`}
                  >
                    <div className="w-16 shrink-0 text-sm font-semibold text-gray-900">
                      {formatTimeEastern(row.start_time)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {patientName(row)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {serviceName(row)} · {clinicianLabel(row.clinician_id)}
                      </p>
                    </div>
                    <span
                      className={
                        statusPositive
                          ? "shrink-0 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700"
                          : "shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                      }
                    >
                      {row.status || "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="min-w-0">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            Billing summary
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <div>
              <BillingRow
                label="Total billed"
                value={formatUsdFromCents(totalBilledThisMonthCents)}
                emphasize
              />
              <BillingRow
                label="Draft"
                value={String(billingSummaryCounts.draft)}
              />
              <BillingRow
                label="Submitted"
                value={String(billingSummaryCounts.submitted)}
              />
              <BillingRow
                label="Paid"
                value={String(billingSummaryCounts.paid)}
              />
              <BillingRow
                label="Denied / partial"
                value={String(billingSummaryCounts.deniedPartial)}
              />
              <BillingRow
                label="Outstanding"
                value={formatUsdFromCents(totalOutstandingThisMonthCents)}
              />
            </div>
          )}
        </section>
      </div>

      <section className="mt-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Appointments — last 7 days
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">Daily volume</p>
        {!loading && chartWeekInsight ? (
          <p className="mt-0.5 text-xs text-gray-400">{chartWeekInsight}</p>
        ) : null}
        <AppointmentsLast7DaysChart
          data={appointmentsLast7DaysChart}
          loading={loading}
        />
      </section>
    </div>
  );
}

function PrimaryMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <p className="text-4xl font-bold tracking-tight tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-2 text-xs font-normal uppercase tracking-widest text-gray-400">
        {label}
      </p>
    </div>
  );
}

function SecondaryMetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <p className="text-4xl font-bold tracking-tight tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-2 text-xs font-normal uppercase tracking-widest text-gray-400">
        {label}
      </p>
    </div>
  );
}

function BillingRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span
        className={
          emphasize
            ? "text-sm font-bold text-gray-900"
            : "text-sm font-medium text-gray-500"
        }
      >
        {label}
      </span>
      <span
        className={`shrink-0 text-right tabular-nums text-gray-900 ${emphasize ? "text-sm font-bold" : "text-sm font-semibold"}`}
      >
        {value}
      </span>
    </div>
  );
}

function AppointmentsLast7DaysChart({
  data,
  loading,
}: {
  data: { day: string; total: number; ymd: string }[];
  loading: boolean;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <ResponsiveContainer width="100%" height={176}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            barCategoryGap="28%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="#F1F5F9"
            />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#9CA3AF", fontSize: 12 }}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#9CA3AF", fontSize: 12 }}
              width={28}
            />
            <Tooltip
              cursor={{ fill: "rgba(243, 244, 246, 0.6)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as {
                  day: string;
                  total: number;
                  ymd: string;
                };
                if (!row) return null;
                return (
                  <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm shadow-sm">
                    <p className="font-medium text-gray-900">{row.day}</p>
                    <p className="mt-1 text-gray-600">
                      Appointments:{" "}
                      <span className="font-semibold tabular-nums text-gray-900">
                        {row.total}
                      </span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="total"
              name="Appointments"
              fill={MUTED_BAR}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

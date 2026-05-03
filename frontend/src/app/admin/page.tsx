"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Phone } from "lucide-react";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  addDaysToYmd,
  formatTimeEastern,
  getEasternYMD,
  getThisWeekRangeEasternYmd,
  isYmdInInclusiveRange,
} from "@/components/adminEastern";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";
const NY = "America/New_York";

const CLINICIAN_WEST_ID = "fb6fa0fc-78f3-48c0-818b-511ad7a8ee93";
const CLINICIAN_SHARPE_ID = "ee6eaa90-1f90-4af7-85a5-4ae78aea3df7";

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
};

/** Shape from GET /voice-agent/conversations (see backend/app/main.py). */
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
    /* eslint-disable react-hooks/purity -- "next upcoming" requires wall-clock comparison */
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

  const weekAppointmentCount = useMemo(() => {
    const { mon, sun } = getThisWeekRangeEasternYmd(new Date());
    return appointments.filter((a) => {
      const ymd = getEasternYMD(new Date(a.start_time));
      return isYmdInInclusiveRange(ymd, mon, sun);
    }).length;
  }, [appointments]);

  const monthAppointmentCount = useMemo(() => {
    const ymd = getEasternYMD(new Date());
    const [yStr, mStr] = ymd.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const mi = m - 1;
    const lastDay = new Date(y, mi + 1, 0).getDate();
    const start = `${yStr}-${mStr}-01`;
    const end = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
    return appointments.filter((a) => {
      const d = getEasternYMD(new Date(a.start_time));
      return d >= start && d <= end;
    }).length;
  }, [appointments]);

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
            (Number(r.total_paid_cents) || 0),
          0,
        ),
    [billingRecordsThisMonth],
  );

  const appointmentsLast7DaysChart = useMemo(() => {
    const todayY = getEasternYMD(new Date());
    const rows: { day: string; west: number; sharpe: number; ymd: string }[] =
      [];
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
      let west = 0;
      let sharpe = 0;
      for (const a of appointments) {
        if (getEasternYMD(new Date(a.start_time)) !== ymd) continue;
        const name = clinicianLabel(a.clinician_id);
        if (name.includes("West")) west += 1;
        else if (name.includes("Sharpe")) sharpe += 1;
      }
      rows.push({ day: dayShort, west, sharpe, ymd });
    }
    return rows;
  }, [appointments]);

  return (
    <div className="w-full bg-gray-50/50">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Overview</h1>
      <p className="mb-10 text-sm tracking-wide text-gray-500">
        Snapshot for clinic operations. Data loads from the live API.
      </p>

      <section className="mb-10">
        {loading ? (
          <div className="rounded-2xl border-l-4 border-l-[#1a6b3c] bg-green-50 p-5 shadow-none">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1a6b3c]">
                {"Today's Focus"}
              </p>
              <FocusAriaStatus ariaOnline={ariaOnline} />
            </div>
            <p className="text-sm text-gray-500">Loading…</p>
          </div>
        ) : nextFocusAppointment ? (
          <div className="rounded-2xl border-l-4 border-l-[#1a6b3c] bg-green-50 p-5 shadow-none">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1a6b3c]">
                {"Today's Focus"}
              </p>
              <FocusAriaStatus ariaOnline={ariaOnline} />
            </div>
            <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-medium text-gray-900">
                  {formatTimeEastern(nextFocusAppointment.start_time)} ·{" "}
                  {patientName(nextFocusAppointment)}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {serviceName(nextFocusAppointment)}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {clinicianLabel(nextFocusAppointment.clinician_id)}
                </p>
              </div>
              <button
                type="button"
                disabled={focusCheckInBusy}
                onClick={() => void handleFocusCheckIn(nextFocusAppointment.id)}
                className="shrink-0 rounded-lg bg-[#1F7A47] px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {focusCheckInBusy ? "Checking in…" : "Check In"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border-l-4 border-l-[#1a6b3c] bg-green-50 p-5 shadow-none">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1a6b3c]">
                {"Today's Focus"}
              </p>
              <FocusAriaStatus ariaOnline={ariaOnline} />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              All caught up — no more appointments today.
            </p>
          </div>
        )}
      </section>

      <div className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label={"Today's Appointments"}
          value={loading ? "…" : String(todayCount)}
          topBorderClass="border-t-4 border-t-[#1a6b3c]"
        />
        <StatCard
          label={"This Week's Appointments"}
          value={loading ? "…" : String(weekAppointmentCount)}
          topBorderClass="border-t-4 border-t-[#1a6b3c]"
        />
        <StatCard
          label="Total Patients"
          value={loading ? "…" : String(patientCount)}
          topBorderClass="border-t-4 border-t-[#1A6B8A]"
        />
        <StatCard
          label={"This Month's Appointments"}
          value={loading ? "…" : String(monthAppointmentCount)}
          topBorderClass="border-t-4 border-t-[#1A6B8A]"
        />
        <StatCard
          label="Billed This Month"
          value={
            loading ? "…" : formatUsdFromCents(totalBilledThisMonthCents)
          }
          topBorderClass="border-t-4 border-t-[#7C3AED]"
        />
        <StatCard
          label="Open PI Cases"
          value={loading ? "…" : String(openPiCasesCount)}
          topBorderClass="border-t-4 border-t-orange-400"
        />
        <StatCard
          label="Total Calls (7 days)"
          value={voiceCalls7dDisplay}
          topBorderClass="border-t-4 border-t-teal-500"
          icon={<Phone className="h-5 w-5 text-gray-400" aria-hidden />}
        />
        <StatCard
          label="Avg Call Duration"
          value={voiceAvgDurationDisplay}
          topBorderClass="border-t-4 border-t-teal-600"
          icon={<Clock className="h-5 w-5 text-gray-400" aria-hidden />}
        />
      </div>

      <div className="mb-6 rounded-2xl bg-gray-50 p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-4 text-xs text-gray-500 uppercase tracking-wide">
              Next 3 Days
            </h2>
            <MiniCalendarStrip appointments={appointments} loading={loading} />
          </section>
          <BillingSummaryCard
            loading={loading}
            draft={billingSummaryCounts.draft}
            submitted={billingSummaryCounts.submitted}
            paid={billingSummaryCounts.paid}
            deniedPartial={billingSummaryCounts.deniedPartial}
            outstandingCents={totalOutstandingThisMonthCents}
          />
        </div>
      </div>

      <section className="mb-10">
        <div className="mb-4">
          <h2 className="mb-1 text-2xl font-semibold text-gray-900">
            Appointments — Last 7 Days
          </h2>
          <p className="text-sm tracking-wide text-gray-500">By clinician</p>
        </div>
        <AppointmentsLast7DaysChart
          data={appointmentsLast7DaysChart}
          loading={loading}
        />
      </section>
    </div>
  );
}

function FocusAriaStatus({ ariaOnline }: { ariaOnline: boolean | null }) {
  const dotClass =
    ariaOnline === true
      ? "bg-green-500"
      : ariaOnline === false
        ? "bg-red-500"
        : "bg-gray-300";
  const statusText =
    ariaOnline === true ? "Online" : ariaOnline === false ? "Offline" : "—";

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`}
        title={statusText}
        aria-label={`Aria voice agent ${statusText}`}
      />
      <span className="font-medium text-gray-700">Aria</span>
      <span className="text-gray-500">{statusText}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  topBorderClass,
  icon,
}: {
  label: string;
  value: string;
  topBorderClass: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border border-gray-100 bg-white p-6 shadow-sm ${topBorderClass}`}
    >
      {icon ? (
        <div className="mb-1 flex justify-end">{icon}</div>
      ) : null}
      <p className="text-3xl font-semibold tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-2 text-xs text-gray-500 uppercase tracking-wide">
        {label}
      </p>
    </div>
  );
}

function BillingSummaryCard({
  loading,
  draft,
  submitted,
  paid,
  deniedPartial,
  outstandingCents,
}: {
  loading: boolean;
  draft: number;
  submitted: number;
  paid: number;
  deniedPartial: number;
  outstandingCents: number;
}) {
  const summaryRows: { key: string; label: string; badge: string }[] = [
    { key: "draft", label: "Draft", badge: "bg-gray-100 text-gray-600" },
    {
      key: "submitted",
      label: "Submitted",
      badge: "bg-yellow-50 text-yellow-700",
    },
    { key: "paid", label: "Paid", badge: "bg-green-50 text-green-700" },
    {
      key: "denied",
      label: "Denied / Partial",
      badge: "bg-red-50 text-red-700",
    },
  ];

  return (
    <section>
      <h2 className="mb-1 text-2xl font-semibold text-gray-900">
        Billing Summary
      </h2>
      <p className="mb-4 text-sm tracking-wide text-gray-500">This month</p>
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="space-y-3">
              {summaryRows.map((r) => (
                <div
                  key={r.key}
                  className="flex items-center justify-between gap-3 text-sm text-gray-700"
                >
                  <span>{r.label}</span>
                  <span
                    className={`inline-flex min-w-[2rem] justify-center rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums ${r.badge}`}
                  >
                    {r.key === "draft"
                      ? draft
                      : r.key === "submitted"
                        ? submitted
                        : r.key === "paid"
                          ? paid
                          : deniedPartial}
                  </span>
                </div>
              ))}
            </div>
            <div className="my-4 border-t border-gray-100" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-gray-600">Total outstanding</span>
              <span className="text-lg font-semibold tabular-nums text-gray-900">
                {formatUsdFromCents(outstandingCents)}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function AppointmentsLast7DaysChart({
  data,
  loading,
}: {
  data: { day: string; west: number; sharpe: number; ymd: string }[];
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-md">
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            barCategoryGap="30%"
            barGap={4}
          >
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
              width={24}
            />
            <Tooltip
              cursor={{ fill: "transparent" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as {
                  day: string;
                  west: number;
                  sharpe: number;
                  ymd: string;
                };
                if (!row) return null;
                return (
                  <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm shadow-md">
                    <p className="font-medium text-gray-900">{row.day}</p>
                    <p className="mt-1 text-gray-600">
                      Dr. West:{" "}
                      <span className="font-medium tabular-nums text-gray-900">
                        {row.west}
                      </span>
                    </p>
                    <p className="text-gray-600">
                      Dr. Sharpe:{" "}
                      <span className="font-medium tabular-nums text-gray-900">
                        {row.sharpe}
                      </span>
                    </p>
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="bottom"
              align="center"
              wrapperStyle={{ paddingTop: 12 }}
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span className="text-sm text-gray-500">{value}</span>
              )}
            />
            <Bar
              dataKey="west"
              name="Dr. West"
              fill="#1A6B8A"
              radius={[4, 4, 0, 0]}
              barSize={28}
            />
            <Bar
              dataKey="sharpe"
              name="Dr. Sharpe"
              fill="#7C3AED"
              radius={[4, 4, 0, 0]}
              barSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function MiniCalendarStrip({
  appointments,
  loading,
}: {
  appointments: AppointmentRow[];
  loading: boolean;
}) {
  const todayYmd = getEasternYMD(new Date());
  const dayKeys = [todayYmd, 1, 2].map((d) =>
    typeof d === "string" ? d : addDaysToYmd(todayYmd, d),
  );

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
      {dayKeys.map((ymd) => {
        const rows = appointments
          .filter((a) => getEasternYMD(new Date(a.start_time)) === ymd)
          .sort(
            (a, b) =>
              new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
          );
        const label = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          month: "numeric",
          day: "numeric",
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

        return (
          <div
            key={ymd}
            className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
          >
            <p className="mb-4 text-sm font-semibold text-gray-900">{label}</p>
            {loading ? (
              <p className="text-xs text-gray-500">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-xs text-gray-400">
                No appointments scheduled
              </p>
            ) : (
              <div className="space-y-4">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl bg-gray-50 px-3 py-2 text-xs transition-colors hover:bg-gray-100"
                  >
                    <p className="font-medium text-gray-900">
                      {formatTimeEastern(row.start_time)}
                    </p>
                    <p className="text-gray-700">{patientName(row)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

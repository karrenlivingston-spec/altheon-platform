"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { addDaysToYmd, getEasternYMD } from "@/components/adminEastern";

import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TD_SECONDARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";

import { useAdminClinic } from "@/app/admin/AdminClinicContext";

const API_BASE = "https://altheon-platform.onrender.com";
const NY = "America/New_York";

type VoiceStatus = { status: string; agent_name?: string };

type VoiceConversation = {
  conversation_id?: string;
  start_time_unix_secs?: number;
  call_duration_secs?: number;
  message_count?: number;
  call_successful?: string;
  transcript_summary?: string | null;
  direction?: string | null;
};

function formatCallDateTime(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  const datePart = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    month: "long",
    day: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${datePart} at ${timePart}`;
}

function formatDurationSecs(secs: number | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(secs) || 0));
  if (s < 60) return "< 1 min";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m} min ${r} sec` : `${m} min`;
}

function avgDurationSecs(convs: VoiceConversation[]): number {
  const nums = convs
    .map((c) => Number(c.call_duration_secs))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function callsThisMonthCount(convs: VoiceConversation[]): number {
  const ymd = getEasternYMD(new Date());
  const [yStr, mStr] = ymd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const mi = m - 1;
  const lastDay = new Date(y, mi + 1, 0).getDate();
  const start = `${yStr}-${mStr}-01`;
  const end = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
  let n = 0;
  for (const c of convs) {
    const u = Number(c.start_time_unix_secs);
    if (!Number.isFinite(u)) continue;
    const d = getEasternYMD(new Date(u * 1000));
    if (d >= start && d <= end) n += 1;
  }
  return n;
}

function outcomeBadge(success: string | undefined): {
  label: string;
  className: string;
} {
  const s = String(success ?? "").toLowerCase();
  if (s === "success") {
    return {
      label: "Completed",
      className:
        "inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600",
    };
  }
  if (s === "failure" || s === "failed") {
    return {
      label: "Failed",
      className:
        "inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600",
    };
  }
  return {
    label: "Unknown",
    className:
      "inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500",
  };
}

function callVolumeLast7Days(convs: VoiceConversation[]): {
  day: string;
  calls: number;
}[] {
  const todayY = getEasternYMD(new Date());
  const rows: { day: string; calls: number; ymd: string }[] = [];
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
    let calls = 0;
    for (const c of convs) {
      const u = Number(c.start_time_unix_secs);
      if (!Number.isFinite(u)) continue;
      if (getEasternYMD(new Date(u * 1000)) === ymd) calls += 1;
    }
    rows.push({ day: dayShort, calls, ymd });
  }
  return rows;
}

export default function AdminVoiceAgentPage() {
  const { clinicId } = useAdminClinic();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [statusFetchOk, setStatusFetchOk] = useState(false);
  const [conversations, setConversations] = useState<VoiceConversation[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [stRes, convRes] = await Promise.all([
          fetch(
            `${API_BASE}/voice-agent/status?clinic_id=${encodeURIComponent(clinicId)}`,
          ),
          fetch(
            `${API_BASE}/voice-agent/conversations?clinic_id=${encodeURIComponent(clinicId)}&page_size=20`,
          ),
        ]);
        if (!cancelled) {
          setStatusFetchOk(stRes.ok);
          if (stRes.ok) {
            const j = (await stRes.json()) as VoiceStatus;
            setStatus(j);
          } else {
            setStatus({ status: "offline" });
          }
          if (convRes.ok) {
            const cj = (await convRes.json()) as { conversations?: unknown };
            const list = Array.isArray(cj.conversations) ? cj.conversations : [];
            setConversations(list as VoiceConversation[]);
          } else {
            setConversations([]);
            setError("Could not load call history.");
          }
        }
      } catch (e) {
        if (!cancelled) {
          setStatusFetchOk(false);
          setStatus({ status: "offline" });
          setConversations([]);
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const agentOnline = Boolean(
    statusFetchOk && status && String(status.status).toLowerCase() === "online",
  );
  const callsMonth = useMemo(
    () => callsThisMonthCount(conversations),
    [conversations],
  );
  const avgSecs = useMemo(
    () => avgDurationSecs(conversations),
    [conversations],
  );
  const chartData = useMemo(
    () => callVolumeLast7Days(conversations),
    [conversations],
  );

  return (
    <div className={DS_PAGE_ROOT}>
      <h1 className={DS_PAGE_TITLE}>Voice Agent</h1>
      <p className={DS_PAGE_SUBTITLE}>Inbound call management and activity</p>

      {error ? (
        <p className="mt-8 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
        <div className={DS_CARD}>
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${agentOnline ? "bg-green-500" : "bg-red-500"}`}
              aria-hidden
            />
            <p className="text-xl font-semibold tabular-nums text-gray-900">
              {loading ? "…" : agentOnline ? "Online" : "Offline"}
            </p>
          </div>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Agent status
          </p>
        </div>
        <div className={DS_CARD}>
          <p className="text-lg font-semibold text-gray-900">
            +1 (561) 328-5880
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Inbound number
          </p>
        </div>
        <div className={DS_CARD}>
          <p className="text-3xl font-semibold tabular-nums text-gray-900">
            {loading ? "…" : String(callsMonth)}
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Calls this month
          </p>
        </div>
        <div className={DS_CARD}>
          <p className="text-xl font-semibold tabular-nums text-gray-900">
            {loading
              ? "…"
              : conversations.length === 0
                ? "—"
                : formatDurationSecs(Math.round(avgSecs))}
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            Avg call duration
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-900">
          Recent Calls
        </h2>
        <p className="mb-4 text-sm text-gray-500">Last 20 inbound calls</p>
        <div className={DS_TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Date &amp; Time</th>
                  <th className={DS_TH}>Duration</th>
                  <th className={DS_TH}>Messages</th>
                  <th className={DS_TH}>Outcome</th>
                  <th className={DS_TH}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-4 text-center text-gray-500"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : conversations.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-4 text-center text-gray-500"
                    >
                      No call records found
                    </td>
                  </tr>
                ) : (
                  conversations.map((row, idx) => {
                    const u = Number(row.start_time_unix_secs);
                    const dt = Number.isFinite(u) ? formatCallDateTime(u) : "—";
                    const badge = outcomeBadge(row.call_successful);
                    const sum = row.transcript_summary ?? "";
                    const short =
                      sum.length > 80 ? `${sum.slice(0, 80)}…` : sum || "—";
                    return (
                      <tr
                        key={row.conversation_id ?? `call-${idx}`}
                        className={DS_TR}
                      >
                        <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                          {dt}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          {formatDurationSecs(row.call_duration_secs)}
                        </td>
                        <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                          {row.message_count ?? "—"}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          <span className={badge.className}>{badge.label}</span>
                        </td>
                        <td
                          className={`max-w-xs truncate ${DS_TD_SECONDARY}`}
                          title={sum || undefined}
                        >
                          {short}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-gray-900">
            Call Volume — Last 7 Days
          </h2>
          <p className="text-sm text-gray-500">Inbound calls by day</p>
        </div>
        <div className={DS_CARD}>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                barCategoryGap="30%"
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
                    const p = payload[0]?.payload as { day: string; calls: number };
                    if (!p) return null;
                    return (
                      <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm shadow-md">
                        <p className="font-medium text-gray-900">{p.day}</p>
                        <p className="text-gray-600">
                          Calls:{" "}
                          <span className="font-medium tabular-nums text-gray-900">
                            {p.calls}
                          </span>
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="calls"
                  name="Calls"
                  fill="#16A34A"
                  radius={[4, 4, 0, 0]}
                  barSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
}

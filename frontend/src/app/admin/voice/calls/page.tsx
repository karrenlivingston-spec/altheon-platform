"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Check, Eye, Loader2 } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_FILTER_BAR,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  CallLogRow,
  CallsListResponse,
  defaultLastNDaysRange,
  formatCallDateTime,
  formatDurationSeconds,
  outcomeBadgeClass,
  outcomeLabel,
  parseTranscriptLines,
  toYmd,
} from "@/components/admin/voice/voiceCallTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
type OutcomeFilter = "all" | "completed" | "incomplete";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className={DS_TR}>
          {Array.from({ length: 7 }).map((__, j) => (
            <td key={j} className={DS_TD_PRIMARY}>
              <div className="h-4 animate-pulse rounded bg-gray-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function CheckOrDash({ value }: { value: boolean }) {
  return value ? (
    <Check className="h-4 w-4 text-green-600" aria-label="Yes" />
  ) : (
    <span className="text-gray-300">—</span>
  );
}

function TranscriptPanel({
  call,
  clinicId,
  onClose,
}: {
  call: CallLogRow;
  clinicId: string;
  onClose: () => void;
}) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/voice/clinic/${encodeURIComponent(clinicId)}/calls/${encodeURIComponent(call.id)}/transcript`,
          { headers: await authHeaders() },
        );
        if (!res.ok) throw new Error(`Transcript fetch failed (${res.status})`);
        const json = (await res.json()) as { transcript?: string | null };
        if (!cancelled) setTranscript(json.transcript ?? null);
      } catch (err) {
        console.error("Transcript load failed:", err);
        if (!cancelled) setTranscript(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [call.id, clinicId]);

  const lines = parseTranscriptLines(transcript);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Call Transcript</h2>
            <p className="text-sm text-gray-500">
              {call.caller_phone?.trim() || "Unknown"} ·{" "}
              {formatCallDateTime(call.started_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[#0D9488]" aria-hidden />
            </div>
          ) : lines.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">
              No transcript available.
            </p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, idx) => {
                if (line.role === "patient") {
                  return (
                    <div key={idx} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gray-100 px-3 py-2 text-sm text-gray-800">
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          Patient
                        </p>
                        {line.text}
                      </div>
                    </div>
                  );
                }
                const isAgent = line.role === "agent";
                return (
                  <div key={idx} className={`flex ${isAgent ? "justify-start" : ""}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        isAgent
                          ? "rounded-bl-sm bg-teal-50 text-teal-900"
                          : "bg-gray-50 text-gray-700"
                      }`}
                      style={isAgent ? { backgroundColor: "rgba(13,148,136,0.1)" } : undefined}
                    >
                      {isAgent ? (
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#0D9488]">
                          Agent
                        </p>
                      ) : null}
                      {line.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VoiceCallsPage() {
  const router = useRouter();
  const { clinicId, role, loading: clinicLoading } = useClinic();
  const isPlatformAdmin =
    role === "super_admin" || role === "platform_admin";

  const defaultRange = defaultLastNDaysRange(30);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [total, setTotal] = useState(0);
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [transcriptCall, setTranscriptCall] = useState<CallLogRow | null>(null);

  const loadCalls = useCallback(async () => {
    if (!clinicId || !isPlatformAdmin) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (outcomeFilter !== "all") params.set("outcome", outcomeFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);

      const res = await fetch(
        `${API_BASE}/voice/clinic/${encodeURIComponent(clinicId)}/calls?${params}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) throw new Error(`Calls fetch failed (${res.status})`);
      const json = (await res.json()) as CallsListResponse;
      setCalls(Array.isArray(json.calls) ? json.calls : []);
      setTotal(Number(json.total) || 0);
    } catch (err) {
      console.error("Call log load failed:", err);
      setCalls([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [clinicId, dateFrom, dateTo, isPlatformAdmin, outcomeFilter, page, pageSize]);

  useEffect(() => {
    if (!clinicLoading && !isPlatformAdmin) {
      router.replace("/admin/voice");
    }
  }, [clinicLoading, isPlatformAdmin, router]);

  useEffect(() => {
    if (!isPlatformAdmin || !clinicId) return;
    void loadCalls();
  }, [clinicId, isPlatformAdmin, loadCalls]);

  useEffect(() => {
    setPage(1);
  }, [outcomeFilter, dateFrom, dateTo, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (clinicLoading || !isPlatformAdmin) {
    return (
      <div className={DS_PAGE_ROOT}>
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
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
          <h1 className={DS_PAGE_TITLE}>Call Log</h1>
          <p className={DS_PAGE_SUBTITLE}>All inbound Aria calls</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-gray-500">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={`${DS_INPUT} w-auto`}
          />
          <label className="text-xs font-medium text-gray-500">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            max={toYmd(new Date())}
            className={`${DS_INPUT} w-auto`}
          />
        </div>
      </div>

      <div className={DS_FILTER_BAR}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "all", label: "All" },
                { value: "completed", label: "Completed" },
                { value: "incomplete", label: "Incomplete" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setOutcomeFilter(opt.value)}
                className={[
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  outcomeFilter === opt.value
                    ? "bg-[#0D9488] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-gray-600">
            Showing {calls.length} of {total} calls
          </p>
        </div>
      </div>

      <div className={`${DS_TABLE_WRAP} mt-6 overflow-x-auto`}>
        <table className="min-w-[56rem] whitespace-nowrap">
          <thead className={DS_TABLE_HEAD}>
            <tr>
              <th className={DS_TH}>Date/Time</th>
              <th className={DS_TH}>Caller</th>
              <th className={DS_TH}>Duration</th>
              <th className={DS_TH}>Outcome</th>
              <th className={DS_TH}>Appt Booked</th>
              <th className={DS_TH}>Intake</th>
              <th className={DS_TH}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-16 text-center">
                  <Bot className="mx-auto mb-3 h-10 w-10 text-gray-300" aria-hidden />
                  <p className="text-sm text-gray-500">
                    No call records found for this period
                  </p>
                </td>
              </tr>
            ) : (
              calls.map((row) => (
                <tr key={row.id} className={DS_TR}>
                  <td className={DS_TD_PRIMARY}>
                    {formatCallDateTime(row.started_at)}
                  </td>
                  <td className={DS_TD_PRIMARY}>
                    {row.caller_phone?.trim() ||
                      row.caller_name?.trim() ||
                      "Unknown"}
                  </td>
                  <td className={DS_TD_PRIMARY}>
                    {formatDurationSeconds(row.duration_seconds)}
                  </td>
                  <td className={DS_TD_PRIMARY}>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${outcomeBadgeClass(row.outcome)}`}
                    >
                      {outcomeLabel(row.outcome)}
                    </span>
                  </td>
                  <td className={DS_TD_PRIMARY}>
                    <CheckOrDash value={Boolean(row.appointment_booked)} />
                  </td>
                  <td className={DS_TD_PRIMARY}>
                    <CheckOrDash value={Boolean(row.intake_completed)} />
                  </td>
                  <td className={DS_TD_PRIMARY}>
                    <button
                      type="button"
                      disabled={!row.has_transcript}
                      onClick={() => row.has_transcript && setTranscriptCall(row)}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                        row.has_transcript
                          ? "text-[#0D9488] hover:bg-teal-50"
                          : "cursor-not-allowed text-gray-300"
                      }`}
                      aria-label="View transcript"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>Page size</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className={`${DS_INPUT} w-auto py-1`}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={DS_SECONDARY_BTN}
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className={DS_SECONDARY_BTN}
          >
            Next
          </button>
        </div>
      </div>

      {transcriptCall && clinicId ? (
        <TranscriptPanel
          call={transcriptCall}
          clinicId={clinicId}
          onClose={() => setTranscriptCall(null)}
        />
      ) : null}
    </div>
  );
}

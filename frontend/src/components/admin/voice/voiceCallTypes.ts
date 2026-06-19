export type CallLogRow = {
  id: string;
  conversation_id: string;
  caller_phone: string | null;
  caller_name: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  appointment_booked: boolean;
  intake_completed: boolean;
  call_summary: string | null;
  call_reason: string | null;
  sentiment: string | null;
  started_at: string | null;
  ended_at: string | null;
  recording_url: string | null;
  has_transcript: boolean;
};

export type CallsListResponse = {
  total: number;
  page: number;
  page_size: number;
  calls: CallLogRow[];
};

export type OutcomeRow = {
  outcome: string;
  count: number;
  percentage: number;
};

export type OutcomesReportResponse = {
  period: { from: string; to: string };
  total_calls: number;
  outcomes: OutcomeRow[];
  booking_rate: number;
  intake_completion_rate: number;
  avg_duration_seconds: number;
  daily_trend: Array<{ date: string; total: number; booked: number }>;
};

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function defaultLastNDaysRange(days: number): { from: string; to: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { from: toYmd(start), to: toYmd(end) };
}

export function formatCallDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export function formatAvgDurationSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

export function formatChartDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function outcomeLabel(outcome: string | null | undefined): string {
  const o = (outcome || "").toLowerCase();
  if (o === "completed") return "Completed";
  if (o === "incomplete") return "Incomplete";
  return outcome?.trim() || "Unknown";
}

export function outcomeBadgeClass(outcome: string | null | undefined): string {
  const o = (outcome || "").toLowerCase();
  if (o === "completed") return "bg-green-50 text-green-700";
  if (o === "incomplete") return "bg-red-50 text-red-600";
  return "bg-gray-100 text-gray-600";
}

export type TranscriptLine = {
  role: "agent" | "patient" | "other";
  text: string;
};

export function parseTranscriptLines(transcript: string | null | undefined): TranscriptLine[] {
  if (!transcript?.trim()) return [];
  return transcript.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (/^agent:/i.test(trimmed)) {
      return { role: "agent" as const, text: trimmed.replace(/^agent:\s*/i, "") };
    }
    if (/^patient:/i.test(trimmed)) {
      return { role: "patient" as const, text: trimmed.replace(/^patient:\s*/i, "") };
    }
    return { role: "other" as const, text: trimmed };
  }).filter((x): x is TranscriptLine => x !== null);
}

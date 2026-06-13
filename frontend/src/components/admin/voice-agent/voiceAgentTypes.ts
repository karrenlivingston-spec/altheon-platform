export type VoiceAgentStats = {
  calls_today: number;
  calls_today_vs_yesterday: number;
  appointments_booked: number;
  appointments_booked_vs_yesterday: number;
  missed_calls: number;
  missed_vs_yesterday: number;
  booking_conversion_pct: number;
  conversion_vs_yesterday: number;
  avg_duration_seconds: number;
  avg_duration_vs_yesterday: number;
  is_online: boolean;
};

export type CallVolumePoint = {
  date: string;
  calls: number;
};

export type OutcomeBreakdownItem = {
  label: string;
  value: number;
  pct: number;
  color: string;
};

export type VoiceOutcomes = {
  total: number;
  breakdown: OutcomeBreakdownItem[];
};

export type RecentCall = {
  id: string;
  patient_id: string | null;
  time: string;
  caller_name: string;
  caller_phone: string;
  duration: string;
  outcome: string;
  outcome_label: string;
  appointment_time: string | null;
  appointment_clinician: string | null;
  summary: string;
  recording_url: string | null;
  success_flag: boolean | null;
  call_sid: string | null;
  transcript: string | null;
};

export type TopCallReason = {
  label: string;
  count: number;
  pct: number;
};

export type VoicePerformance = {
  call_answer_rate_pct: number;
  answer_rate_vs_last_period: number;
  patient_satisfaction: number;
  satisfaction_vs_last: number;
  avg_answer_time_seconds: number;
  answer_time_vs_last: number;
};

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s`;
}

export function trendText(
  delta: number,
  opts?: { suffix?: string; invert?: boolean },
): { text: string; positive: boolean } {
  const suffix = opts?.suffix ?? "";
  const invert = opts?.invert ?? false;
  const good = invert ? delta <= 0 : delta >= 0;
  const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
  const abs = Math.abs(delta);
  return {
    text: `${arrow} ${abs}${suffix} vs yesterday`,
    positive: good,
  };
}

export function outcomeBadgeClass(outcome: string): string {
  const o = outcome.toLowerCase();
  if (o === "appointment_booked" || o.includes("book")) {
    return "bg-green-50 text-green-700";
  }
  if (o === "general_inquiry" || o.includes("inquir")) {
    return "bg-blue-50 text-blue-700";
  }
  if (o === "reschedule" || o.includes("resched")) {
    return "bg-amber-50 text-amber-700";
  }
  if (o === "voicemail" || o === "missed") {
    return "bg-purple-50 text-purple-700";
  }
  return "bg-gray-100 text-gray-600";
}

export const REASON_ICONS: Record<string, string> = {
  "Schedule Appointment": "📅",
  "General Inquiry": "💬",
  Reschedule: "🔄",
  "Insurance Question": "🏥",
  "Other / Transfer": "📞",
};

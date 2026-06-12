export type ScheduleRow = {
  id: string;
  start_time: string;
  patient_name: string;
  treatment_type: string;
  clinician_name: string;
  status: string;
};

export type ClaimsActionBucket = {
  count: number;
  amount_cents: number;
};

export type ActivityItem = {
  type: string;
  description: string;
  link_to: string;
  timestamp: string;
};

export type DashboardSummary = {
  appointments_today: number;
  patients_this_week: number;
  patients_last_week: number;
  collections_mtd_cents: number;
  total_billed_mtd_cents: number;
  claims_summary: {
    paid: number;
    pending: number;
    denied: number;
    submitted: number;
  };
  claims_requiring_action: {
    denied: ClaimsActionBucket;
    pending: ClaimsActionBucket;
    ready_to_send: ClaimsActionBucket;
    unbilled: ClaimsActionBucket;
  };
  aria: {
    calls_today: number;
    booked_today: number;
    missed_today: number;
    avg_duration_seconds: number;
    success_rate: number;
    is_online: boolean;
  };
  tasks: {
    incomplete_intakes: number;
    notes_review: number;
    legal_in_progress: number;
    unconfirmed_appointments: number;
  };
  schedule_today: ScheduleRow[];
  upcoming_appointments: ScheduleRow[];
  recent_activity: ActivityItem[];
};

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s`;
}

export function relativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

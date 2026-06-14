export type ClinicalNotesStats = {
  total_notes: number;
  ai_generated: number;
  ai_generated_pct: number;
  needs_review: number;
  provider_signed: number;
  provider_signed_pct: number;
  attorney_requested: number;
  completed: number;
  tab_counts: {
    all: number;
    needs_review: number;
    ai_generated: number;
    provider_signed: number;
    attorney_requested: number;
    completed: number;
  };
  trends: {
    total: number | null;
    ai_generated: number | null;
    needs_review: number | null;
    provider_signed: number | null;
    attorney_requested: number | null;
  };
  insights: {
    ai_acceptance_rate: number;
    ai_acceptance_trend: number | null;
    ai_daily_counts: number[];
    top_ai_note_types: Array<{ note_type: string; count: number; pct: number }>;
    review_turnaround_days: number;
    review_turnaround_trend: number | null;
    signature_compliance_48h_pct: number;
    signature_compliance_trend: number | null;
  };
};

export type NoteGoal = {
  id: string;
  note_id: string;
  description: string;
  goal_type: "short_term" | "long_term";
  target_weeks: number | null;
  percent_met: number;
};

export type GoalSuggestion = {
  description: string;
  goal_type: "short_term" | "long_term";
  target_weeks: number | null;
};

export type ClinicalNoteListItem = {
  id: string;
  patient_id: string;
  patient_name?: string | null;
  patient_pt_id?: string | null;
  visit_date?: string | null;
  note_type?: string | null;
  body_region?: string | null;
  clinician_name?: string | null;
  ai_generated?: boolean;
  review_status?: string | null;
  signature_status?: string | null;
  attorney_requested?: boolean;
  attorney_request_date?: string | null;
  created_at?: string | null;
  signed_at?: string | null;
  status?: string | null;
  author_id?: string;
  author_name?: string | null;
  supervising_pt_name?: string | null;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  appointment_id?: string | null;
  supervising_pt_id?: string | null;
  cpt_codes_detected?: unknown[] | null;
  ai_feedback?: string | null;
  correction_notes?: string | null;
  signed_despite_ai_flag?: boolean | null;
};

export type ScopeTab = "my" | "all" | "review";
export type FilterTab =
  | "all"
  | "needs_review"
  | "ai_generated"
  | "provider_signed"
  | "attorney_requested"
  | "completed";

export type SidebarFilters = {
  dateFrom: string;
  dateTo: string;
  noteTypes: string[];
  clinicianId: string;
  aiStatus: string;
  reviewStatus: string;
};

export function defaultSidebarFilters(): SidebarFilters {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 42);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
    noteTypes: [],
    clinicianId: "",
    aiStatus: "",
    reviewStatus: "",
  };
}

export function noteTypeLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    daily_note: "Daily Note",
    initial_evaluation: "Initial Evaluation",
    progress_note: "Progress Note",
    discharge_note: "Discharge Summary",
    re_evaluation: "Re-Evaluation",
    other: "Other",
  };
  return map[t] || raw || "—";
}

export function patientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}

export function formatNoteDateTime(iso: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" };
  return {
    date: d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

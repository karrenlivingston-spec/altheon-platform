export type AppointmentStats = {
  appointments_today: number;
  scheduled: number;
  scheduled_pct: number;
  no_shows: number;
  no_shows_week: number;
  utilization_pct: number;
  avg_visit_duration_min: number;
  avg_visit_duration_week_min: number;
  upcoming_count: number;
};

export type AppointmentTasks = {
  intakes_pending: number;
  consent_forms_missing: number;
  insurance_verifications: number;
  claims_ready: number;
};

export type ClinicianUtilization = {
  clinician_id: string;
  clinician_name: string;
  credentials: string;
  utilization_pct: number;
  appointments_count: number;
};

export type AriaStats = {
  calls_today: number;
  appointments_booked: number;
  reschedules: number;
  missed_calls: number;
};

export type DayListItem = {
  id: string;
  start_time: string;
  end_time: string;
  start_time_iso?: string;
  patient_name: string;
  patient_avatar_initials: string;
  patient_pt_id?: string;
  treatment_type: string;
  visit_subtype: string;
  clinician_name: string;
  clinician_color?: string;
  status: string;
  is_virtual: boolean;
  is_blocked: boolean;
  tags: string[];
};

export type UpcomingItem = {
  id: string;
  day_label: string;
  date_label: string;
  start_time: string;
  patient_name: string;
  treatment_type: string;
  clinician_name: string;
  status: string;
};

export const STATUS_STYLES: Record<
  string,
  { dot: string; badge: string; border: string }
> = {
  confirmed: {
    dot: "bg-green-500",
    badge: "bg-green-50 text-green-700",
    border: "border-l-green-500",
  },
  scheduled: {
    dot: "bg-blue-500",
    badge: "bg-blue-50 text-blue-700",
    border: "border-l-blue-500",
  },
  checked_in: {
    dot: "bg-orange-500",
    badge: "bg-orange-50 text-orange-700",
    border: "border-l-orange-500",
  },
  in_progress: {
    dot: "bg-purple-500",
    badge: "bg-purple-50 text-purple-700",
    border: "border-l-purple-500",
  },
  no_show: {
    dot: "bg-red-500",
    badge: "bg-red-50 text-red-700",
    border: "border-l-red-500",
  },
  blocked: {
    dot: "bg-gray-400",
    badge: "bg-gray-100 text-gray-600",
    border: "border-l-gray-400",
  },
  completed: {
    dot: "bg-gray-500",
    badge: "bg-gray-100 text-gray-600",
    border: "border-l-gray-400",
  },
};

export function statusStyle(status: string) {
  return STATUS_STYLES[status.toLowerCase()] ?? STATUS_STYLES.scheduled;
}

export function statusLabel(status: string): string {
  if (status === "blocked") return "Blocked";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

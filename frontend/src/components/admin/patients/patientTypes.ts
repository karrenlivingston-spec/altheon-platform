export type PatientHeaderStats = {
  patient_display_id: string;
  insurance_status: string;
  insurance_carrier: string | null;
  last_visit_date: string | null;
  last_visit_clinician: string | null;
  next_appointment_date: string | null;
  next_appointment_time: string | null;
  next_appointment_clinician: string | null;
  balance_due_cents: number;
  care_plan_total_visits: number;
  care_plan_completed_visits: number;
  care_plan_label: string;
  patient_since: string | null;
  clinical_summary: {
    primary_complaint: string;
    treating_provider: string;
    care_plan: string;
    last_treatment: string;
    outcome_score: string;
  };
  tags: string[];
  upcoming_appointments: Array<{
    id: string;
    start_time: string;
    month_label: string | null;
    time_label: string | null;
    treatment_type: string;
    clinician_name: string;
    status: string;
  }>;
  recent_activity: Array<{
    type: string;
    description: string;
    timestamp: string;
    badge: string;
    link_to: string;
  }>;
  account_summary: {
    total_balance_cents: number;
    insurance_balance_cents: number;
    patient_balance_cents: number;
  };
};

export type ReferralSource =
  | "google"
  | "facebook"
  | "instagram"
  | "attorney"
  | "existing_patient"
  | "doctor_referral"
  | "website"
  | "walk_in"
  | "other";

export const REFERRAL_SOURCE_OPTIONS: { value: ReferralSource; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "attorney", label: "Attorney" },
  { value: "existing_patient", label: "Existing Patient" },
  { value: "doctor_referral", label: "Doctor Referral" },
  { value: "website", label: "Website" },
  { value: "walk_in", label: "Walk In" },
  { value: "other", label: "Other" },
];

export function referralSourceLabel(
  value: ReferralSource | string | null | undefined,
): string {
  if (!value) return "—";
  const found = REFERRAL_SOURCE_OPTIONS.find((o) => o.value === value);
  return found?.label ?? "—";
}

export type PatientRecord = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  insurance_carrier?: string | null;
  insurance_policy_number?: string | null;
  insurance_group_number?: string | null;
  primary_complaint?: string | null;
  referring_provider?: string | null;
  referral_source?: ReferralSource | string | null;
  created_at?: string | null;
};

export function patientDisplayName(p: PatientRecord): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Patient";
}

export function patientInitials(p: PatientRecord): string {
  const a = (p.first_name ?? "").trim().charAt(0);
  const b = (p.last_name ?? "").trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

export function formatDob(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd).trim());
  if (!m) return ymd;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export function ageFromDob(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd).trim());
  if (!m) return null;
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const md = today.getMonth() - birth.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function fullAddress(p: PatientRecord): string {
  const parts = [
    p.address_line1,
    p.address_line2,
    [p.city, p.state].filter(Boolean).join(", "),
    p.zip,
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
  return parts.join(", ") || "—";
}

export function relativeActivityTime(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

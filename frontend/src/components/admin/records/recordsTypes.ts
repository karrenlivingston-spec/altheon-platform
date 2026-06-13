export type RecordsStats = {
  generated_this_month: number;
  generated_vs_last_month: number;
  pending_requests: number;
  pending_overdue: number;
  shared_this_month: number;
  shared_vs_last_month: number;
  downloads_this_month: number;
  on_time_delivery_pct: number;
};

export type RecentExport = {
  id: string;
  patient_name: string;
  patient_avatar_initials: string;
  patient_pt_id: string;
  generated_by: string;
  exported_at: string;
  record_types: string[];
  page_count: number;
  status: string;
  file_url: string | null;
  recipient_email: string | null;
};

export type AttorneyRequest = {
  id: string;
  patient_name: string;
  firm_name: string;
  requested_date: string;
  records_due_date: string | null;
  days_until_due: number;
  is_overdue: boolean;
  status: string;
};

export type TypeBreakdownItem = {
  label: string;
  count: number;
  pct: number;
  color: string;
};

export type TypeBreakdown = {
  total: number;
  breakdown: TypeBreakdownItem[];
};

export const RECORD_TYPE_OPTIONS = [
  {
    id: "clinical_notes",
    label: "Clinical Notes",
    description: "SOAP notes and progress notes",
    icon: "document",
  },
  {
    id: "evaluations",
    label: "Evaluations",
    description: "Initial and re-evaluations",
    icon: "clipboard",
  },
  {
    id: "billing",
    label: "Billing",
    description: "Charges, payments and statements",
    icon: "billing",
  },
  {
    id: "imaging",
    label: "Imaging",
    description: "X-rays, MRIs and attachments",
    icon: "imaging",
  },
  {
    id: "other",
    label: "Other Documents",
    description: "Forms and miscellaneous",
    icon: "folder",
  },
] as const;

export type RecordTypeId = (typeof RECORD_TYPE_OPTIONS)[number]["id"];

export function pctTrendText(delta: number): string {
  if (delta > 0) return `↑ ${delta}% vs last month`;
  if (delta < 0) return `↓ ${Math.abs(delta)}% vs last month`;
  return "→ 0% vs last month";
}

export function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed") return "bg-green-50 text-green-700";
  if (s === "processing") return "bg-amber-50 text-amber-700";
  if (s === "failed") return "bg-red-50 text-red-700";
  return "bg-gray-100 text-gray-600";
}

export function recordTypeLabel(t: string): string {
  const map: Record<string, string> = {
    clinical_notes: "Clinical Notes",
    evaluations: "Evaluations",
    billing: "Billing",
    imaging: "Imaging",
    other: "Other",
  };
  return map[t] || t;
}

export function defaultDateFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function defaultDateTo(): string {
  return new Date().toISOString().slice(0, 10);
}

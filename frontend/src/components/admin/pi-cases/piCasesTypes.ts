export type PiCaseStatus =
  | "intake_open"
  | "treatment"
  | "records_requested"
  | "settlement_negotiation"
  | "closed_settled";

export type PiCaseBoardItem = {
  id: string;
  patient_id?: string;
  patient_name: string;
  patient_pt_id?: string;
  insurance_carrier?: string | null;
  firm_name?: string | null;
  attorney_name?: string | null;
  date_of_accident?: string | null;
  estimated_settlement?: number | null;
  demand_amount?: number | null;
  settled_amount?: number | null;
  records_due_date?: string | null;
  hearing_date?: string | null;
  status: PiCaseStatus | string;
  attorney_request_pending?: boolean;
  case_tags?: string[];
  days_in_status?: number;
  is_overdue?: boolean;
  days_overdue?: number;
  claim_number?: string | null;
  attorney_email?: string | null;
  attorney_phone?: string | null;
  records_requested_date?: string | null;
  settlement_date?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PiCaseBoard = Record<PiCaseStatus, PiCaseBoardItem[]>;

export type PiCaseStats = {
  open_cases: number;
  new_this_week: number;
  records_requested: number;
  records_overdue: number;
  records_outstanding: number;
  amount_at_risk: number;
  est_settlement_value: number;
  settlement_change_this_month: number;
  closed_ytd: number;
  closed_vs_last_month: number;
  status_counts?: Record<string, number>;
};

export type PiCaseActivity = {
  description: string;
  tag: string;
  timestamp: string;
  type: "overdue" | "upload" | "settlement" | "update" | "hearing";
};

export type PiCaseDeadline = {
  date: string;
  label: string;
  subtitle: string;
  days_until: number;
  is_overdue: boolean;
  type: "records" | "hearing" | "ime";
};

export type PiCaseTopAttorney = {
  firm_name: string;
  case_count: number;
  total_value: number;
};

export const KANBAN_COLUMNS: Array<{
  id: PiCaseStatus;
  label: string;
  accent: "default" | "blue" | "amber" | "purple" | "green";
  border: string;
  chartColor: string;
}> = [
  {
    id: "intake_open",
    label: "Intake / Open",
    accent: "default",
    border: "border-l-gray-400",
    chartColor: "#9ca3af",
  },
  {
    id: "treatment",
    label: "Treatment In Progress",
    accent: "blue",
    border: "border-l-blue-500",
    chartColor: "#3b82f6",
  },
  {
    id: "records_requested",
    label: "Records Requested",
    accent: "amber",
    border: "border-l-amber-500",
    chartColor: "#f59e0b",
  },
  {
    id: "settlement_negotiation",
    label: "Settlement Negotiation",
    accent: "purple",
    border: "border-l-purple-500",
    chartColor: "#a855f7",
  },
  {
    id: "closed_settled",
    label: "Closed / Settled",
    accent: "green",
    border: "border-l-green-500",
    chartColor: "#16a34a",
  },
];

export const STATUS_FLOW: PiCaseStatus[] = [
  "intake_open",
  "treatment",
  "records_requested",
  "settlement_negotiation",
  "closed_settled",
];

export const STATUS_OPTIONS = KANBAN_COLUMNS.map((c) => ({
  value: c.id,
  label: c.label,
}));

export function formatUsd(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

export function nextStatus(current: string | null | undefined): PiCaseStatus | null {
  const idx = STATUS_FLOW.indexOf((current ?? "") as PiCaseStatus);
  if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

export function prevStatus(current: string | null | undefined): PiCaseStatus | null {
  const idx = STATUS_FLOW.indexOf((current ?? "") as PiCaseStatus);
  if (idx <= 0) return null;
  return STATUS_FLOW[idx - 1];
}

export const COLUMN_HEADER: Record<
  (typeof KANBAN_COLUMNS)[number]["accent"],
  { text: string; badge: string }
> = {
  default: { text: "text-gray-800", badge: "bg-gray-100 text-gray-700" },
  blue: { text: "text-blue-800", badge: "bg-blue-100 text-blue-800" },
  amber: { text: "text-amber-800", badge: "bg-amber-100 text-amber-800" },
  purple: { text: "text-purple-800", badge: "bg-purple-100 text-purple-800" },
  green: { text: "text-green-800", badge: "bg-green-100 text-green-800" },
};

export function statusTagLabel(item: PiCaseBoardItem): string {
  if (item.status === "closed_settled" && item.settled_amount) {
    return `Settled ${formatUsd(item.settled_amount)}`;
  }
  const tags = item.case_tags ?? [];
  if (tags.length > 0) return tags[0];
  if (item.status === "intake_open") return "Intake";
  if (item.status === "treatment") return "Active";
  if (item.status === "settlement_negotiation") return "Negotiating";
  if (item.status === "closed_settled") return "Settled";
  return "Active";
}

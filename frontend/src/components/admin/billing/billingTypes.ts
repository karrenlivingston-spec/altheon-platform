export type ClaimsActionBucket = {
  count: number;
  amount_cents?: number;
};

export type BillingClaimRow = {
  id: string;
  claim_number: string;
  patient_name: string;
  insurance_carrier: string;
  date_of_service: string | null;
  total_billed_cents: number;
  amount_paid_cents: number;
  amount_remaining_cents: number;
  status: string;
  created_at?: string | null;
};

/** Full insurance claim from GET /billing/claims/{id} */
export type InsuranceClaimDetail = {
  id: string;
  clinic_id?: string;
  patient_id: string;
  clinician_id?: string | null;
  appointment_id?: string | null;
  first_treatment_date?: string | null;
  payer_name?: string | null;
  payer_id?: string | null;
  policy_number?: string | null;
  member_id?: string | null;
  total_amount?: number | null;
  diagnosis_codes?: string[] | null;
  cpt_codes?: string[] | null;
  notes?: string | null;
  status?: string | null;
  claim_number?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  filing_deadline?: string | null;
  days_remaining?: number | null;
  audit_log?: unknown[];
};

export type RecentPaymentRow = {
  amount_cents: number;
  payment_date: string;
  payment_method?: string | null;
  note?: string | null;
  carrier: string;
  patient_name: string;
};

export type PayerSummaryRow = {
  carrier: string;
  billed_cents: number;
  collected_cents: number;
  collection_rate: number;
};

export type PayerSummaryDetailRow = {
  payer_name: string;
  total_billed: number;
  total_collected: number;
  total_outstanding: number;
  claim_count: number;
  paid_count: number;
  denied_count: number;
  collection_rate: number;
};

export type PayerSummaryReportData = {
  summary: {
    total_payers: number;
    total_billed_all: number;
    total_collected_all: number;
    overall_collection_rate: number;
  };
  payers: PayerSummaryDetailRow[];
};

export type InsuranceCoverageDetail = {
  category: string;
  coverage_level: string;
  amount: string | number;
};

export type InsuranceVerificationResult = {
  eligible: boolean;
  plan_name: string;
  plan_begin_date: string;
  subscriber_name: string;
  member_id: string;
  group_number: string;
  copay: number | null;
  deductible: number | null;
  deductible_met: number | null;
  out_of_pocket_max: number | null;
  out_of_pocket_met: number | null;
  coverage_details: InsuranceCoverageDetail[];
  raw_response: Record<string, unknown>;
  verification_id?: string;
  verified_at?: string;
};

export type InsuranceVerificationHistoryRow = {
  id: string;
  payer_id: string;
  member_id: string;
  verified_at: string;
  eligible: boolean;
  plan_name: string;
  copay: number | null;
  deductible: number | null;
};

export function collectionRateBarColor(rate: number): string {
  if (rate >= 80) return "bg-green-500";
  if (rate >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

export type AgingBucketKey = "0_30" | "31_60" | "61_90" | "90_plus";

export type AgingBucketFilter = "all" | AgingBucketKey;

export type AgingSummaryBucket = {
  bucket: AgingBucketKey;
  label: string;
  count: number;
  total_amount: number;
  total_amount_cents: number;
};

export type AgingClaimRow = {
  id: string;
  claim_number: string;
  patient_name: string;
  payer_name: string;
  first_treatment_date: string | null;
  total_amount: number;
  status: string;
  days_outstanding: number;
  bucket: AgingBucketKey;
};

export type AgingReportData = {
  summary: AgingSummaryBucket[];
  aging: BillingDashboardData["aging"];
  claims: AgingClaimRow[];
};

export const AGING_BUCKET_META = [
  {
    key: "bucket_0_30" as const,
    filter: "0_30" as const,
    label: "0–30 Days",
    shortLabel: "0–30",
    color: "#16a34a",
    cardClass: "border-green-200 bg-green-50",
    textClass: "text-green-800",
  },
  {
    key: "bucket_31_60" as const,
    filter: "31_60" as const,
    label: "31–60 Days",
    shortLabel: "31–60",
    color: "#eab308",
    cardClass: "border-yellow-200 bg-yellow-50",
    textClass: "text-yellow-900",
  },
  {
    key: "bucket_61_90" as const,
    filter: "61_90" as const,
    label: "61–90 Days",
    shortLabel: "61–90",
    color: "#f97316",
    cardClass: "border-orange-200 bg-orange-50",
    textClass: "text-orange-900",
  },
  {
    key: "bucket_90_plus" as const,
    filter: "90_plus" as const,
    label: "90+ Days",
    shortLabel: "90+",
    color: "#dc2626",
    cardClass: "border-red-200 bg-red-50",
    textClass: "text-red-800",
  },
] as const;

export function formatUsdAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export type BillingDashboardData = {
  metrics: {
    total_billed_mtd_cents: number;
    collected_mtd_cents: number;
    outstanding_cents: number;
    claims_submitted: number;
    claims_denied: number;
    avg_collection_cents: number;
    billed_trend_pct: number;
    collected_trend_pct: number;
  };
  claims_action: {
    denied: ClaimsActionBucket;
    pending: ClaimsActionBucket;
    ready_to_send: ClaimsActionBucket;
    unbilled: { count: number };
  };
  aging: {
    bucket_0_30: number;
    bucket_31_60: number;
    bucket_61_90: number;
    bucket_90_plus: number;
    total: number;
  };
  payer_summary: PayerSummaryRow[];
  claims: BillingClaimRow[];
  claims_total: number;
  claims_status_counts: {
    all: number;
    submitted: number;
    pending: number;
    denied: number;
    paid: number;
    draft: number;
  };
  recent_payments: RecentPaymentRow[];
};

export function formatUsdFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatUsdFromCentsPrecise(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function claimStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === "partial" || s === "pending") return "Pending";
  if (s === "draft") return "Draft";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function claimStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  const base = "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (s === "paid") return `${base} bg-green-50 text-green-700`;
  if (s === "partial" || s === "pending") return `${base} bg-amber-50 text-amber-700`;
  if (s === "denied") return `${base} bg-red-50 text-red-600`;
  if (s === "submitted") return `${base} bg-blue-50 text-blue-700`;
  return `${base} bg-gray-100 text-gray-600`;
}

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

export const CLAIM_STATUS_OPTIONS = [
  "draft",
  "submitted",
  "pending",
  "denied",
  "paid",
] as const;

export function exportClaimsCsv(
  claims: InsuranceClaimDetail[],
  filename: string,
  patientNameById?: Record<string, string>,
) {
  const headers = [
    "Patient Name",
    "Payer Name",
    "Policy Number",
    "Member ID",
    "Total Amount",
    "Status",
    "Date of Service",
    "CPT Codes",
    "Diagnosis Codes",
  ];
  const escape = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const rows = claims.map((c) => {
    const dx = Array.isArray(c.diagnosis_codes) ? c.diagnosis_codes.join("; ") : "";
    const cpt = Array.isArray(c.cpt_codes) ? c.cpt_codes.join("; ") : "";
    const patientName =
      (c.patient_id && patientNameById?.[c.patient_id]) || c.patient_id || "";
    return [
      patientName,
      c.payer_name ?? "",
      c.policy_number ?? "",
      c.member_id ?? "",
      c.total_amount != null ? String(c.total_amount) : "",
      c.status ?? "",
      c.first_treatment_date ?? "",
      cpt,
      dx,
    ]
      .map((cell) => escape(String(cell)))
      .join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

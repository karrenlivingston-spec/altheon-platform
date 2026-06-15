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

/** APS (Athlete Performance Score) — shared types and display helpers. */

export type ApsConfidenceTier = "high" | "moderate" | "low" | null;

export type ApsOutlierFindingRef = {
  test_type: string;
  metric_name: string;
};

export type ApsSessionSummary = {
  overall_tier: ApsConfidenceTier;
  total_notable_findings: number;
  dominant_side: "left" | "right" | null;
  dominant_cluster_size: number;
  outlier_count: number;
  outlier_findings: ApsOutlierFindingRef[];
};

export type ApsFinding = {
  id?: string;
  aps_session_id?: string;
  test_type: string;
  metric_name: string;
  left_value?: number | null;
  right_value?: number | null;
  combined_value?: number | null;
  unit?: string | null;
  asymmetry_pct?: number | null;
  is_notable?: boolean;
  confidence_tier?: ApsConfidenceTier;
  recommended_next_test?: string | null;
  created_at?: string | null;
};

export type ApsSession = {
  id: string;
  clinic_id: string;
  patient_id: string;
  session_date: string;
  source_filename?: string | null;
  raw_extracted_json?: Record<string, unknown> | null;
  findings?: ApsFinding[];
  session_summary?: ApsSessionSummary;
  created_at?: string | null;
};

export type ApsTierCounts = {
  high: number;
  moderate: number;
  low: number;
};

export type ApsClinicNotableFinding = {
  patient_name: string;
  test_type: string;
  metric_name: string;
  asymmetry_pct: number | null;
  side: string | null;
  is_outlier?: boolean;
};

export type ApsTestingVolumePoint = {
  date: string;
  count: number;
};

export type ApsClinicSessionStats = {
  total_sessions: number;
  sessions_this_month: number;
  distinct_patients: number;
  tier_counts: ApsTierCounts;
  notable_findings_count: number;
  notable_findings: ApsClinicNotableFinding[];
  testing_volume: ApsTestingVolumePoint[];
};

export const EMPTY_APS_TIER_COUNTS: ApsTierCounts = {
  high: 0,
  moderate: 0,
  low: 0,
};

export type ApsClinicSessionListItem = ApsSession & {
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_name?: string | null;
  patient_sport?: string | null;
};

export type ApsClinicSessionsResponse = {
  stats: ApsClinicSessionStats;
  total: number;
  limit: number;
  offset: number;
  sessions: ApsClinicSessionListItem[];
};

export function tierCountsTotal(counts: ApsTierCounts): number {
  return counts.high + counts.moderate + counts.low;
}

export function apsTierCountTextClass(tier: "high" | "moderate" | "low"): string {
  switch (tier) {
    case "high":
      return "text-blue-800";
    case "moderate":
      return "text-amber-900";
    case "low":
      return "text-slate-700";
  }
}

export function apsTierCountShortLabel(tier: "high" | "moderate" | "low"): string {
  switch (tier) {
    case "high":
      return "High";
    case "moderate":
      return "Moderate";
    case "low":
      return "Low";
  }
}

export const APS_TIER_CHART_COLORS: Record<"high" | "moderate" | "low", string> = {
  high: "#1e40af",
  moderate: "#78350f",
  low: "#334155",
};

export function formatNotableFindingLine(finding: ApsClinicNotableFinding): string {
  const pct =
    finding.asymmetry_pct != null && !Number.isNaN(finding.asymmetry_pct)
      ? `${Math.round(finding.asymmetry_pct * 10) / 10}%`
      : "—";
  const sidePart = finding.side ? ` ${finding.side}` : "";
  return `${finding.patient_name} — ${finding.test_type}${sidePart} ${pct}`;
}

export const APS_TEST_ORDER = [
  "CMJ",
  "SJ",
  "SLCMJ",
  "DJ",
  "SLDJ",
  "RJT",
  "MULTIPLE_JUMPS",
] as const;

export const APS_TEST_LABELS: Record<string, string> = {
  CMJ: "Counter Movement Jump (CMJ)",
  SJ: "Squat Jump (SJ)",
  SLCMJ: "Single-Leg Counter Movement Jump (SLCMJ)",
  DJ: "Drop Jump (DJ)",
  SLDJ: "Single-Leg Drop Jump (SLDJ)",
  RJT: "Repetitive Jumps Test (RJT)",
  MULTIPLE_JUMPS: "Multiple Jumps",
};

export const APS_METRIC_LABELS: Record<string, string> = {
  jump_height: "Jump height",
  peak_force_relative: "Peak force (relative)",
  peak_power_relative: "Peak power (relative)",
  braking_rfd: "Braking RFD",
  propulsive_rfd: "Propulsive RFD",
  rsi: "RSI",
  peak_rfd: "Peak RFD",
  number_of_jumps: "Number of jumps",
  height_average: "Height average",
  duration: "Duration",
  fatigue_index: "Fatigue index",
  pace: "Pace",
  average_power: "Average power",
};

export function formatApsDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso));
}

export function formatMetricValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

export function apsTierBadgeClass(tier: ApsConfidenceTier): string {
  const base = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium";
  switch (tier) {
    case "high":
      return `${base} bg-blue-50 text-blue-800 ring-1 ring-blue-100`;
    case "moderate":
      return `${base} bg-amber-50 text-amber-900 ring-1 ring-amber-100`;
    case "low":
      return `${base} bg-slate-100 text-slate-700 ring-1 ring-slate-200`;
    default:
      return `${base} bg-gray-100 text-gray-600 ring-1 ring-gray-200`;
  }
}

export function apsTierLabel(tier: ApsConfidenceTier): string {
  switch (tier) {
    case "high":
      return "Strong pattern";
    case "moderate":
      return "Isolated finding";
    case "low":
      return "Mixed pattern";
    default:
      return "No notable asymmetries";
  }
}

export function apsSessionSummaryLine(summary: ApsSessionSummary | undefined): string {
  if (!summary || summary.overall_tier == null) {
    return "No notable asymmetries found in this session.";
  }
  if (summary.overall_tier === "high" && summary.dominant_side) {
    return `${summary.dominant_cluster_size} of ${summary.total_notable_findings} tested metrics point to a ${summary.dominant_side}-side deficit — recommend confirmatory testing before acting on this pattern.`;
  }
  if (summary.overall_tier === "moderate") {
    return "One isolated finding — recommend confirming before acting on this pattern.";
  }
  return "Findings are inconsistent across tests — recommend repeat testing before concluding a pattern.";
}

export function isOutlierFinding(
  finding: ApsFinding,
  summary: ApsSessionSummary | undefined,
): boolean {
  if (!summary?.outlier_findings?.length) return false;
  return summary.outlier_findings.some(
    (o) =>
      o.test_type === finding.test_type && o.metric_name === finding.metric_name,
  );
}

export function isCombinedOnlyFinding(finding: ApsFinding): boolean {
  return (
    finding.combined_value != null &&
    finding.left_value == null &&
    finding.right_value == null
  );
}

export function mapApsUploadError(status: number, detail: string): string {
  const lower = detail.toLowerCase();
  if (status === 422) {
    if (
      lower.includes("no jump test") ||
      lower.includes("could not parse") ||
      lower.includes("parse") ||
      lower.includes("json") ||
      lower.includes("extract")
    ) {
      return "We couldn't read jump-test data from this PDF. Please upload a Kinvent Smart Mode force-plate report (.pdf).";
    }
    if (lower.includes("empty")) {
      return "The selected file appears to be empty. Choose a different PDF and try again.";
    }
    return "This PDF could not be analyzed. Confirm it is a Kinvent force-plate report and try again.";
  }
  if (status === 400) {
    return detail || "Invalid file. Only PDF uploads are supported.";
  }
  if (status === 401 || status === 403) {
    return "Your session may have expired. Refresh the page and try again.";
  }
  return "Something went wrong while uploading the report. Please try again.";
}

export function groupFindingsByTestType(
  findings: ApsFinding[],
): Map<string, ApsFinding[]> {
  const map = new Map<string, ApsFinding[]>();
  for (const f of findings) {
    const key = f.test_type || "UNKNOWN";
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return map;
}

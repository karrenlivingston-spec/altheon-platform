export type QuestionnaireResultRow = {
  questionnaire_type: string;
  body_region: string;
  total_score: number | null;
  score_percentage: number | null;
  responses: Record<string, unknown>;
  submitted_at: string | null;
};

export function questionnaireDisplayName(type: string): string {
  switch ((type || "").toLowerCase()) {
    case "oswestry":
      return "Modified Oswestry Low Back Pain Questionnaire";
    case "ndi":
      return "Neck Disability Index (NDI)";
    case "lefs":
      return "Lower Extremity Functional Scale (LEFS)";
    case "quickdash":
      return "QuickDASH";
    default:
      return type;
  }
}

export function questionnaireInterpretation(
  type: string,
  totalScore: number | null,
  scorePct: number | null,
): string {
  const t = (type || "").toLowerCase();
  if (t === "lefs") {
    const s = totalScore ?? 0;
    if (s <= 20) return "severe";
    if (s <= 40) return "moderate";
    if (s <= 60) return "mild";
    return "minimal";
  }
  if (t === "quickdash") {
    const p = scorePct ?? 0;
    if (p <= 20) return "minimal";
    if (p <= 40) return "mild";
    if (p <= 60) return "moderate";
    if (p <= 80) return "severe";
    return "complete disability";
  }
  if (t === "ndi") {
    const p = scorePct ?? 0;
    if (p <= 8) return "no disability";
    if (p <= 28) return "mild disability";
    if (p <= 48) return "moderate disability";
    if (p <= 64) return "severe disability";
    return "complete disability";
  }
  const p = scorePct ?? 0;
  if (p <= 20) return "minimal";
  if (p <= 40) return "moderate";
  if (p <= 60) return "severe";
  if (p <= 80) return "crippling";
  return "bed-bound";
}

export function formatQuestionnaireScore(row: QuestionnaireResultRow): string {
  const t = (row.questionnaire_type || "").toLowerCase();
  if (t === "lefs") {
    return `${row.total_score ?? "—"} / 80`;
  }
  if (t === "quickdash") {
    return row.score_percentage != null ? `${row.score_percentage}` : "—";
  }
  return row.total_score != null
    ? `${row.total_score}${row.score_percentage != null ? ` (${row.score_percentage}%)` : ""}`
    : "—";
}

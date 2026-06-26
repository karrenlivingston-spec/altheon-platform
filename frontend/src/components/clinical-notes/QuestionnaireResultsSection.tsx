"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { apiAuthHeaders } from "@/lib/apiAuth";
import {
  formatQuestionnaireScore,
  questionnaireDisplayName,
  questionnaireInterpretation,
  type QuestionnaireResultRow,
} from "@/lib/questionnaireUtils";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export function QuestionnaireResultsSection({
  appointmentId,
  clinicId,
}: {
  appointmentId: string;
  clinicId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<QuestionnaireResultRow[] | null>(null);

  useEffect(() => {
    setExpanded(false);
    setResults(null);
    setLoading(false);
    setError(null);
  }, [appointmentId]);

  useEffect(() => {
    if (!expanded || !appointmentId || !clinicId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const headers = await apiAuthHeaders();
        const params = new URLSearchParams({
          appointment_id: appointmentId,
          clinic_id: clinicId,
        });
        const res = await fetch(
          `${API_BASE}/questionnaires/results?${params.toString()}`,
          { headers },
        );
        const data = (await res.json().catch(() => [])) as QuestionnaireResultRow[];
        if (cancelled) return;
        if (!res.ok) {
          throw new Error("Could not load questionnaire results");
        }
        setResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (cancelled) return;
        setResults([]);
        setError(
          e instanceof Error ? e.message : "Could not load questionnaire results",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, appointmentId, clinicId]);

  return (
    <div className="rounded-xl border border-gray-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-gray-50"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
          Questionnaire Results
        </span>
        {results && results.length > 0 ? (
          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700">
            {results.length} completed
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="border-t border-gray-100 px-4 py-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading questionnaire results…
            </p>
          ) : null}

          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {!loading && !error && !results?.length ? (
            <p className="text-sm text-gray-500">
              No questionnaire results found for this appointment
            </p>
          ) : null}

          {!loading && !error && results?.length ? (
            <div className="space-y-3">
              {results.map((row, idx) => (
                <div
                  key={`${row.questionnaire_type}-${row.submitted_at ?? idx}`}
                  className={idx > 0 ? "border-t border-gray-100 pt-3" : undefined}
                >
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Questionnaire
                    </p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {questionnaireDisplayName(row.questionnaire_type)}
                    </p>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Score
                    </p>
                    <p className="mt-1 text-sm text-gray-900">
                      {formatQuestionnaireScore(row)}
                    </p>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Interpretation
                    </p>
                    <p className="mt-1 text-sm text-gray-900">
                      {questionnaireInterpretation(
                        row.questionnaire_type,
                        row.total_score,
                        row.score_percentage,
                      )}
                    </p>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Responses
                    </p>
                    <div className="mt-1 space-y-1">
                      {Object.entries(row.responses || {}).map(([key, val]) => (
                        <p key={key} className="text-sm text-gray-900">
                          <span className="font-medium text-gray-600">{key}:</span>{" "}
                          {String(val)}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

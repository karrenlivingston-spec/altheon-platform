"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Printer } from "lucide-react";

import {
  DS_CARD,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import CptDetectionPanel from "@/components/CptDetectionPanel";
import { SpecialTestsSection } from "@/components/clinical-notes/SpecialTestsSection";
import {
  injectIntakePrintStylesAndPrint,
  intakeMedicalHistoryPills,
  painDotClass,
} from "@/lib/intakePrint";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const NY = "America/New_York";

export type IntakeFormRow = {
  id: string;
  appointment_id?: string | null;
  patient_id?: string | null;
  chief_complaint?: string | null;
  pain_scale?: number | null;
  symptom_duration?: string | null;
  aggravating_factors?: string | null;
  relieving_factors?: string | null;
  medical_history_flags?: unknown;
  allergies?: string | null;
  other_conditions?: string | null;
  goals?: string | null;
  created_at?: string | null;
  submitted_at?: string | null;
};

type ClinicalNoteRow = {
  id: string;
  patient_id?: string;
  note_type?: string | null;
  status?: string | null;
  body_region?: string | null;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  created_at?: string | null;
  signed_at?: string | null;
  author_name?: string | null;
  clinician_first_name?: string | null;
  clinician_last_name?: string | null;
  patient_name?: string | null;
  ai_feedback?: string | null;
  correction_notes?: string | null;
  cpt_codes_detected?: unknown;
};

type TimelineItem =
  | {
      kind: "intake";
      id: string;
      dateKey: string;
      sortTs: number;
      intake: IntakeFormRow;
    }
  | {
      kind: "note";
      id: string;
      dateKey: string;
      sortTs: number;
      note: ClinicalNoteRow;
    };

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function toDateKey(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: NY,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function toSortTs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

function formatTimelineDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

function formatIntakeSubmittedDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: NY,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(raw));
  } catch {
    return "—";
  }
}

function chiefComplaintSummary(text: string | null | undefined, maxLen = 80): string {
  const s = (text ?? "").trim() || "(No complaint recorded)";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function noteTypeLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    daily_note: "Daily Note",
    initial_evaluation: "Initial Evaluation",
    progress_note: "Progress Note",
    discharge_note: "Discharge Note",
  };
  return map[t] || "SOAP";
}

function noteStatusLabel(status: string | null | undefined): string {
  const s = (status ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    draft: "Draft",
    ai_review_pending: "AI review",
    ready_for_review: "Ready for review",
    ai_flagged: "Needs edits",
    needs_correction: "Correction requested",
    signed: "Signed",
  };
  return map[s] || status || "—";
}

function clinicianName(note: ClinicalNoteRow): string {
  const fromParts = `${note.clinician_first_name ?? ""} ${note.clinician_last_name ?? ""}`.trim();
  if (fromParts) return fromParts;
  const author = (note.author_name ?? "").trim();
  return author || "Unknown";
}

function bodyRegionLabel(note: ClinicalNoteRow): string {
  return (note.body_region ?? "").trim() || "—";
}

function showSpecialTestsForNoteType(noteType: string | null | undefined): boolean {
  return (noteType ?? "").trim().toLowerCase() !== "daily_note";
}

function clinicalNoteStatusBadgeClass(status: string): string {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const s = status.toLowerCase();
  switch (s) {
    case "draft":
      return `${base} bg-gray-100 text-gray-600`;
    case "signed":
      return `${base} bg-emerald-900/90 text-emerald-50`;
    default:
      return `${base} bg-gray-100 text-gray-600`;
  }
}

function IntakeFormDetail({
  intake,
  patientDisplay,
  printDomId,
  expanded,
}: {
  intake: IntakeFormRow;
  patientDisplay: string;
  printDomId: string;
  expanded: boolean;
}) {
  const submittedLabel = formatIntakeSubmittedDate(
    intake.submitted_at ?? intake.created_at,
  );

  return (
    <div
      id={printDomId}
      className={expanded ? "border-t border-gray-100 bg-gray-50/50" : "hidden"}
    >
      <div className="intake-print-print-only mb-4 hidden px-4 pt-4 text-center text-base font-semibold text-gray-900">
        Straight To The Point Dry Needling
      </div>
      <div className="px-4 pt-4">
        <p className="text-sm font-semibold text-gray-900">{patientDisplay}</p>
        <p className="intake-print-field-value intake-print-meta-line mt-1 text-xs text-gray-600">
          Submitted {submittedLabel}
        </p>
      </div>

      <section className="mx-4 mb-4 mt-4 rounded-lg border border-gray-200 bg-white">
        <header className="border-l-4 border-[#16A34A] bg-gray-50 px-4 py-3">
          <h3 className="intake-print-doc-title text-sm font-semibold text-gray-900">
            Pre-Visit Intake Summary
          </h3>
        </header>
        <div className="space-y-3 px-4 py-4">
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Chief Complaint
            </p>
            <p className="intake-print-field-value mt-1 text-sm font-semibold text-gray-900">
              {intake.chief_complaint?.trim() || "Not provided"}
            </p>
          </div>
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Pain Scale
            </p>
            <div className="intake-print-field-value mt-1 flex items-center gap-2 text-sm text-gray-900">
              <span
                className={`h-2.5 w-2.5 rounded-full ${painDotClass(intake.pain_scale)}`}
                aria-hidden
              />
              <span>
                {intake.pain_scale != null
                  ? `${intake.pain_scale} / 10`
                  : "Not provided"}
              </span>
            </div>
          </div>
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Symptom Duration
            </p>
            <p className="intake-print-field-value mt-1 text-sm text-gray-900">
              {intake.symptom_duration?.trim() || "Not provided"}
            </p>
          </div>
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Aggravating Factors
            </p>
            <p className="intake-print-field-value mt-1 text-sm text-gray-900">
              {intake.aggravating_factors?.trim() || "Not provided"}
            </p>
          </div>
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Relieving Factors
            </p>
            <p className="intake-print-field-value mt-1 text-sm text-gray-900">
              {intake.relieving_factors?.trim() || "Not provided"}
            </p>
          </div>
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Medical History Flags
            </p>
            <div className="intake-print-field-value mt-1 flex flex-wrap gap-2">
              {(() => {
                const pills = intakeMedicalHistoryPills(intake.medical_history_flags);
                if (!pills.length) {
                  return (
                    <span className="text-sm text-gray-500">None reported</span>
                  );
                }
                return pills.map((pill, idx) => (
                  <span
                    key={`${pill}-${idx}`}
                    className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700"
                  >
                    {pill}
                  </span>
                ));
              })()}
            </div>
          </div>
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Allergies
            </p>
            <p className="intake-print-field-value mt-1 text-sm text-gray-900">
              {intake.allergies?.trim() || "Not provided"}
            </p>
          </div>
          <div className="intake-print-field-row">
            <p className="intake-print-field-label text-xs font-medium uppercase tracking-wide text-gray-500">
              Goals
            </p>
            <p className="intake-print-field-value mt-1 text-sm text-gray-900">
              {intake.goals?.trim() || "Not provided"}
            </p>
          </div>
        </div>
        <footer className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
          Submitted {submittedLabel}
        </footer>
      </section>

      <div className="intake-print-print-only intake-print-confidential-footer mx-4 mb-4 hidden px-2 text-center text-xs text-gray-600">
        Confidential — Clinical Use Only
      </div>
    </div>
  );
}

function ClinicalNoteViewModal({
  note,
  clinicId,
  loading,
  onClose,
}: {
  note: ClinicalNoteRow;
  clinicId: string;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto ${DS_CARD}`}
        role="dialog"
        aria-modal
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {note.patient_name?.trim() || "Patient"}
            </h2>
            <p className="text-sm text-gray-500">
              {noteTypeLabel(note.note_type)} ·{" "}
              <span className={clinicalNoteStatusBadgeClass(note.status ?? "")}>
                {noteStatusLabel(note.status)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-gray-500">Loading…</p>
        ) : null}

        <div className="mt-6 space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Subjective</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-900">
              {note.subjective?.trim() || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Objective</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-900">
              {note.objective?.trim() || "—"}
            </p>
          </div>
          {showSpecialTestsForNoteType(note.note_type) ? (
            <SpecialTestsSection noteId={note.id} clinicId={clinicId} readOnly />
          ) : null}
          <CptDetectionPanel
            noteId={note.id}
            clinicId={clinicId}
            initialCodes={
              Array.isArray(note.cpt_codes_detected) ? note.cpt_codes_detected : []
            }
          />
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Assessment</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-900">
              {note.assessment?.trim() || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-gray-500">Plan</p>
            <p className="mt-1 whitespace-pre-wrap text-gray-900">
              {note.plan?.trim() || "—"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  patientId: string;
  clinicId: string;
  patientDisplayName: string;
};

export function PatientVisitTimeline({
  patientId,
  clinicId,
  patientDisplayName,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  const [expandedIntakeIds, setExpandedIntakeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [viewNote, setViewNote] = useState<ClinicalNoteRow | null>(null);
  const [viewNoteLoading, setViewNoteLoading] = useState(false);

  const loadTimeline = useCallback(async () => {
    if (!patientId || !clinicId) return;
    setLoading(true);
    setFetchError(null);
    setItems([]);
    setExpandedDates(new Set());
    setExpandedIntakeIds(new Set());

    try {
      const h = await authHeaders();
      const [intakeRes, notesRes] = await Promise.all([
        fetch(`${API_BASE}/intake/patient/${encodeURIComponent(patientId)}`, {
          headers: h,
        }),
        fetch(
          `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/clinical-notes`,
          { headers: h },
        ),
      ]);

      const timelineItems: TimelineItem[] = [];

      if (intakeRes.ok) {
        const intakeJson = (await intakeRes.json()) as { intakes?: unknown };
        const intakes = Array.isArray(intakeJson.intakes)
          ? (intakeJson.intakes as IntakeFormRow[])
          : [];
        for (const intake of intakes) {
          const rawDate = intake.submitted_at ?? intake.created_at;
          const dateKey = toDateKey(rawDate);
          if (!dateKey) continue;
          const id = String(intake.id ?? "").trim() || `intake-${dateKey}`;
          timelineItems.push({
            kind: "intake",
            id,
            dateKey,
            sortTs: toSortTs(rawDate),
            intake,
          });
        }
      }

      if (notesRes.ok) {
        const notesJson = await notesRes.json();
        const notes = Array.isArray(notesJson) ? (notesJson as ClinicalNoteRow[]) : [];
        for (const note of notes) {
          const rawDate = note.signed_at ?? note.created_at;
          const dateKey = toDateKey(rawDate);
          if (!dateKey) continue;
          timelineItems.push({
            kind: "note",
            id: String(note.id),
            dateKey,
            sortTs: toSortTs(rawDate),
            note,
          });
        }
      } else if (!intakeRes.ok) {
        const detail = await notesRes.text().catch(() => "");
        throw new Error(
          intakeRes.status === 401 || intakeRes.status === 403
            ? "Sign in required to load visit timeline."
            : detail.trim() || "Could not load visit timeline.",
        );
      }

      setItems(timelineItems);
      const dateKeys = [
        ...new Set(timelineItems.map((i) => i.dateKey)),
      ].sort((a, b) => b.localeCompare(a));
      if (dateKeys.length > 0) {
        setExpandedDates(new Set([dateKeys[0]]));
      }
    } catch (e) {
      setFetchError(
        e instanceof Error ? e.message : "Could not load visit timeline.",
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of items) {
      const list = map.get(item.dateKey) ?? [];
      list.push(item);
      map.set(item.dateKey, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => b.sortTs - a.sortTs);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  function toggleDate(dateKey: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  }

  function toggleIntakeExpanded(id: string) {
    setExpandedIntakeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openNote(note: ClinicalNoteRow) {
    setViewNote(note);
    setViewNoteLoading(true);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(note.id)}`,
        { headers: h },
      );
      if (res.ok) {
        setViewNote((await res.json()) as ClinicalNoteRow);
      }
    } catch {
      /* keep list row */
    } finally {
      setViewNoteLoading(false);
    }
  }

  return (
    <>
      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading visit timeline…
        </div>
      ) : fetchError ? (
        <p className="mt-4 text-sm text-amber-800">{fetchError}</p>
      ) : groupedByDate.length === 0 ? (
        <p className="mt-6 text-center text-sm text-gray-500">
          No visit history yet.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {groupedByDate.map(([dateKey, dayItems]) => {
            const expanded = expandedDates.has(dateKey);
            return (
              <div
                key={dateKey}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggleDate(dateKey)}
                  className="flex w-full items-center gap-3 bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100"
                >
                  <span className="shrink-0 text-gray-400" aria-hidden>
                    {expanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                  <span className="flex-1 font-semibold text-gray-900">
                    {formatTimelineDate(dateKey)}
                  </span>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {dayItems.length} item{dayItems.length === 1 ? "" : "s"}
                  </span>
                </button>

                {expanded ? (
                  <div className="divide-y divide-gray-100">
                    {dayItems.map((item) => {
                      if (item.kind === "intake") {
                        const intake = item.intake;
                        const printDomId = `timeline-intake-print-${item.id}`;
                        const intakeExpanded = expandedIntakeIds.has(item.id);
                        return (
                          <div key={item.id}>
                            <div className="flex flex-wrap items-start gap-3 px-4 py-3">
                              <span className="text-base" aria-hidden>
                                📋
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-gray-900">
                                  Intake Form
                                </p>
                                <p className="mt-0.5 text-sm text-gray-600">
                                  {chiefComplaintSummary(intake.chief_complaint)}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="intake-print-toolbar-btn inline-flex items-center gap-1.5 rounded-md border border-[#16A34A] px-2.5 py-1 text-xs font-medium text-[#16A34A] hover:bg-green-50"
                                  title="Download PDF"
                                  aria-label="Download PDF"
                                  onClick={() =>
                                    injectIntakePrintStylesAndPrint(printDomId)
                                  }
                                >
                                  <Printer className="size-3.5 shrink-0" aria-hidden />
                                  Download PDF
                                </button>
                                <button
                                  type="button"
                                  className={DS_SECONDARY_BTN}
                                  onClick={() => toggleIntakeExpanded(item.id)}
                                >
                                  {intakeExpanded ? "Hide" : "View"}
                                </button>
                              </div>
                            </div>
                            <IntakeFormDetail
                              intake={intake}
                              patientDisplay={patientDisplayName}
                              printDomId={printDomId}
                              expanded={intakeExpanded}
                            />
                          </div>
                        );
                      }

                      const note = item.note;
                      const clinician = clinicianName(note);
                      return (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-start gap-3 px-4 py-3"
                        >
                          <span className="text-base" aria-hidden>
                            📝
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900">
                              Clinical Note — {clinician}
                            </p>
                            <p className="mt-0.5 text-sm text-gray-600">
                              {noteTypeLabel(note.note_type)} ·{" "}
                              {noteStatusLabel(note.status)} ·{" "}
                              {bodyRegionLabel(note)}
                            </p>
                          </div>
                          <button
                            type="button"
                            className={DS_SECONDARY_BTN}
                            onClick={() => void openNote(note)}
                          >
                            Open Note
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {viewNote ? (
        <ClinicalNoteViewModal
          note={viewNote}
          clinicId={clinicId}
          loading={viewNoteLoading}
          onClose={() => setViewNote(null)}
        />
      ) : null}
    </>
  );
}

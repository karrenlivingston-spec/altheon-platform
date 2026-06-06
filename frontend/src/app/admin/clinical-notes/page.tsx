"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";

import { useClinic } from "@/app/admin/ClinicContext";
import { supabase } from "@/lib/supabase";
import {
  AmbientScribe,
  type SoapFromScribe,
} from "@/components/clinical-notes/AmbientScribe";
import { MeasurementModule } from "@/components/clinical-notes/MeasurementModule";
import CptDetectionPanel, {
  type CptCode,
} from "@/components/CptDetectionPanel";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const MEASUREMENT_CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";

const UPCOMING_APPOINTMENT_STATUSES = new Set(["scheduled", "confirmed"]);

type AppointmentListRow = {
  id: string;
  patient_id?: string;
  start_time?: string;
  status?: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function normalizeAppointmentStatus(status: string | null | undefined): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function pickAppointmentIdForPatient(
  rows: AppointmentListRow[],
  patientId: string,
): string {
  const pid = patientId.trim();
  if (!pid) return "";

  const forPatient = rows.filter(
    (r) => String(r.patient_id ?? "").trim() === pid,
  );
  if (forPatient.length === 0) return "";

  const now = Date.now();

  const upcoming = forPatient
    .filter((r) => {
      const st = normalizeAppointmentStatus(r.status);
      if (!UPCOMING_APPOINTMENT_STATUSES.has(st)) return false;
      const t = Date.parse(String(r.start_time ?? ""));
      return !Number.isNaN(t) && t >= now;
    })
    .sort(
      (a, b) =>
        Date.parse(String(a.start_time ?? "")) -
        Date.parse(String(b.start_time ?? "")),
    );

  if (upcoming.length > 0) {
    return String(upcoming[0].id ?? "").trim();
  }

  const past = forPatient
    .filter((r) => {
      const t = Date.parse(String(r.start_time ?? ""));
      return !Number.isNaN(t) && t < now;
    })
    .sort(
      (a, b) =>
        Date.parse(String(b.start_time ?? "")) -
        Date.parse(String(a.start_time ?? "")),
    );

  if (past.length > 0) {
    return String(past[0].id ?? "").trim();
  }

  return "";
}

type PatientRow = {
  id: string;
  first_name?: string;
  last_name?: string;
};

type ClinicalNote = {
  id: string;
  patient_id: string;
  clinic_id: string;
  author_id: string;
  supervising_pt_id?: string | null;
  appointment_id?: string | null;
  note_type?: string | null;
  status?: string | null;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  ai_feedback?: string | null;
  ai_reviewed_at?: string | null;
  correction_notes?: string | null;
  signed_at?: string | null;
  signed_by?: string | null;
  cpt_codes_detected?: CptCode[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  patient_name?: string | null;
  author_name?: string | null;
  supervising_pt_name?: string | null;
};

const NOTE_TYPE_OPTIONS = [
  { value: "daily_note", label: "Daily Note" },
  { value: "initial_evaluation", label: "Initial Evaluation" },
  { value: "progress_note", label: "Progress Note" },
  { value: "discharge_note", label: "Discharge Note" },
] as const;

function patientDisplayName(p: PatientRow): string {
  const s = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return s || "—";
}

function noteTypeLabel(raw: string | null | undefined): string {
  const t = (raw ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    daily_note: "Daily Note",
    initial_evaluation: "Initial Evaluation",
    progress_note: "Progress Note",
    discharge_note: "Discharge Note",
  };
  return map[t] || raw || "—";
}

function clinicalNoteStatusBadgeClass(status: string): string {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";
  const s = status.toLowerCase();
  switch (s) {
    case "draft":
      return `${base} bg-gray-100 text-gray-600`;
    case "ai_review_pending":
      return `${base} bg-blue-50 text-blue-700 animate-pulse`;
    case "ready_for_review":
      return `${base} bg-green-50 text-green-800`;
    case "ai_flagged":
      return `${base} bg-red-50 text-red-700`;
    case "needs_correction":
      return `${base} bg-orange-50 text-orange-800`;
    case "signed":
      return `${base} bg-emerald-900/90 text-emerald-50`;
    default:
      return `${base} bg-gray-100 text-gray-600`;
  }
}

function clinicalNoteStatusLabel(status: string): string {
  const s = status.toLowerCase();
  const labels: Record<string, string> = {
    draft: "Draft",
    ai_review_pending: "AI review",
    ready_for_review: "Ready for review",
    ai_flagged: "Needs edits",
    needs_correction: "Correction requested",
    signed: "Signed",
  };
  return labels[s] || status;
}

function formatNoteDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function canEditNote(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return (
    s === "draft" || s === "ai_flagged" || s === "needs_correction"
  );
}

export default function AdminClinicalNotesPage() {
  const { clinic_id: clinicId, me } = useClinic();
  const supabaseUserId = (me?.user_id ?? "").trim();
  /** clinical_notes.author_id is clinic_users.id; /me exposes clinic_user_id for list/save. */
  const notesAuthorId = (me?.clinic_user_id ?? "").trim() || supabaseUserId;
  const signedByCandidate = supabaseUserId || clinicId;

  const [activeTab, setActiveTab] = useState<"my" | "review">("my");

  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [myNotes, setMyNotes] = useState<ClinicalNote[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ClinicalNote[]>([]);
  const [signedRecent, setSignedRecent] = useState<ClinicalNote[]>([]);

  const [loadingMy, setLoadingMy] = useState(true);
  const [loadingReview, setLoadingReview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [patientInputValue, setPatientInputValue] = useState("");
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const patientPickerRef = useRef<HTMLDivElement>(null);
  const [draftPatientId, setDraftPatientId] = useState("");
  const [draftNoteType, setDraftNoteType] = useState<string>("daily_note");
  const [draftSupervisingPtId, setDraftSupervisingPtId] = useState("");
  const [draftSubjective, setDraftSubjective] = useState("");
  const [draftObjective, setDraftObjective] = useState("");
  const [draftAppointmentId, setDraftAppointmentId] = useState("");
  const [draftAssessment, setDraftAssessment] = useState("");
  const [draftPlan, setDraftPlan] = useState("");
  const [draftCptCodes, setDraftCptCodes] = useState<CptCode[] | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);

  const [viewNote, setViewNote] = useState<ClinicalNote | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [reviewNote, setReviewNote] = useState<ClinicalNote | null>(null);
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [showCorrectionField, setShowCorrectionField] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  const [scribeBannerVisible, setScribeBannerVisible] = useState(false);
  const [diagnosticPrefillBannerVisible, setDiagnosticPrefillBannerVisible] =
    useState(false);
  const [sessionTranscript, setSessionTranscript] = useState("");
  const [transcriptPanelOpen, setTranscriptPanelOpen] = useState(false);

  const SOAP_STORAGE_KEY = "altheon:soap-prefill";

  const applySoapPrefill = useCallback(
    (soap: {
      subjective?: string;
      objective?: string;
      assessment?: string;
      plan?: string;
    }) => {
      if (soap.subjective) setDraftSubjective(soap.subjective);
      if (soap.objective) setDraftObjective(soap.objective);
      if (soap.assessment) setDraftAssessment(soap.assessment);
      if (soap.plan) setDraftPlan(soap.plan);
      sessionStorage.removeItem(SOAP_STORAGE_KEY);
      setDiagnosticPrefillBannerVisible(true);
    },
    [],
  );

  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        subjective?: string;
        objective?: string;
        assessment?: string;
        plan?: string;
      };
      if (detail) applySoapPrefill(detail);
    };
    window.addEventListener("altheon:soap-prefill", onPrefill);
    try {
      const raw = sessionStorage.getItem(SOAP_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          subjective?: string;
          objective?: string;
          assessment?: string;
          plan?: string;
        };
        applySoapPrefill(parsed);
      }
    } catch {
      /* ignore */
    }
    return () => window.removeEventListener("altheon:soap-prefill", onPrefill);
  }, [applySoapPrefill]);

  const handleSoapFromScribe = useCallback((soap: SoapFromScribe) => {
    setEditingId(null);
    setDraftPatientId("");
    setDraftAppointmentId("");
    setPatientInputValue("");
    setPatientPickerOpen(false);
    setDraftNoteType("daily_note");
    setDraftSupervisingPtId("");
    setDraftSubjective(soap.subjective);
    setDraftObjective(soap.objective);
    setDraftAssessment(soap.assessment);
    setDraftPlan(soap.plan);
    setSessionTranscript(soap.transcript);
    setScribeBannerVisible(true);
    setTranscriptPanelOpen(false);
    setEditorOpen(true);
  }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshPendingReviewCount = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/clinics/${encodeURIComponent(clinicId)}/clinical-notes?status=ready_for_review`,
      );
      if (!res.ok) return;
      const j = await res.json();
      setPendingReviewCount(Array.isArray(j) ? j.length : 0);
    } catch {
      /* ignore */
    }
  }, [clinicId]);

  const loadPatients = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}`,
      );
      const json = res.ok ? await res.json() : [];
      setPatients(Array.isArray(json) ? json : []);
    } catch {
      setPatients([]);
    }
  }, [clinicId]);

  const loadMyNotes = useCallback(async () => {
    if (!notesAuthorId) {
      setMyNotes([]);
      setLoadingMy(false);
      return;
    }
    setLoadingMy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinics/${encodeURIComponent(clinicId)}/clinical-notes?author_id=${encodeURIComponent(notesAuthorId)}`,
      );
      if (!res.ok) {
        setError(await res.text().catch(() => `HTTP ${res.status}`));
        setMyNotes([]);
        return;
      }
      const json = await res.json();
      setMyNotes(Array.isArray(json) ? json : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notes");
      setMyNotes([]);
    } finally {
      setLoadingMy(false);
    }
  }, [clinicId, notesAuthorId]);

  const loadReviewData = useCallback(async () => {
    setLoadingReview(true);
    setError(null);
    try {
      const [qRes, sRes] = await Promise.all([
        fetch(
          `${API_BASE}/api/clinics/${encodeURIComponent(clinicId)}/clinical-notes?status=ready_for_review`,
        ),
        fetch(
          `${API_BASE}/api/clinics/${encodeURIComponent(clinicId)}/clinical-notes?status=signed`,
        ),
      ]);
      const qJson = qRes.ok ? await qRes.json() : [];
      const sJson = sRes.ok ? await sRes.json() : [];
      const queue = Array.isArray(qJson) ? qJson : [];
      const signed = Array.isArray(sJson) ? sJson : [];
      setReviewQueue(queue);
      setPendingReviewCount(queue.length);
      setSignedRecent(signed.slice(0, 10));
      if (!qRes.ok) {
        setError(await qRes.text().catch(() => `Queue HTTP ${qRes.status}`));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review queue");
    } finally {
      setLoadingReview(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    void refreshPendingReviewCount();
  }, [refreshPendingReviewCount]);

  useEffect(() => {
    if (activeTab === "my") {
      void loadMyNotes();
    } else {
      void loadReviewData();
    }
  }, [activeTab, loadMyNotes, loadReviewData]);

  const hasPendingAi = useMemo(
    () =>
      myNotes.some(
        (n) => (n.status ?? "").toLowerCase() === "ai_review_pending",
      ),
    [myNotes],
  );

  useEffect(() => {
    if (activeTab !== "my" || !hasPendingAi) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      void loadMyNotes();
    }, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeTab, hasPendingAi, loadMyNotes]);

  const resolveAppointmentForPatient = useCallback(async (patientId: string) => {
    const pid = patientId.trim();
    if (!pid) {
      setDraftAppointmentId("");
      return;
    }
    try {
      const params = new URLSearchParams({
        clinic_id: MEASUREMENT_CLINIC_ID,
        patient_id: pid,
      });
      const res = await fetch(`${API_BASE}/appointments?${params.toString()}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setDraftAppointmentId("");
        return;
      }
      const data: unknown = await res.json();
      const rows = Array.isArray(data) ? (data as AppointmentListRow[]) : [];
      setDraftAppointmentId(pickAppointmentIdForPatient(rows, pid));
    } catch {
      setDraftAppointmentId("");
    }
  }, []);

  useEffect(() => {
    if (!editorOpen || editingId) return;
    const pid = draftPatientId.trim();
    if (!pid) {
      setDraftAppointmentId("");
      return;
    }
    void resolveAppointmentForPatient(pid);
  }, [editorOpen, editingId, draftPatientId, resolveAppointmentForPatient]);

  function resetEditor() {
    setEditingId(null);
    setDraftPatientId("");
    setDraftNoteType("daily_note");
    setDraftSupervisingPtId("");
    setDraftSubjective("");
    setDraftObjective("");
    setDraftAppointmentId("");
    setDraftAssessment("");
    setDraftPlan("");
    setDraftCptCodes(null);
    setPatientInputValue("");
    setPatientPickerOpen(false);
    setScribeBannerVisible(false);
    setSessionTranscript("");
    setTranscriptPanelOpen(false);
  }

  function openNewNote() {
    resetEditor();
    setEditorOpen(true);
  }

  async function openEditorForNote(note: ClinicalNote) {
    setEditorBusy(true);
    setError(null);
    setScribeBannerVisible(false);
    setSessionTranscript("");
    setTranscriptPanelOpen(false);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(note.id)}`,
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      const row = (await res.json()) as ClinicalNote;
      setEditingId(row.id);
      setDraftPatientId(row.patient_id);
      setDraftNoteType((row.note_type ?? "daily_note").toLowerCase());
      setDraftSupervisingPtId((row.supervising_pt_id ?? "").trim());
      setDraftSubjective(row.subjective ?? "");
      setDraftObjective(row.objective ?? "");
      setDraftAppointmentId((row.appointment_id ?? "").trim());
      setDraftAssessment(row.assessment ?? "");
      setDraftPlan(row.plan ?? "");
      setDraftCptCodes(
        Array.isArray(row.cpt_codes_detected) ? row.cpt_codes_detected : null,
      );
      const picked = patients.find((x) => x.id === row.patient_id);
      setPatientInputValue(
        picked
          ? patientDisplayName(picked)
          : `Patient ${String(row.patient_id).slice(0, 8)}…`,
      );
      setPatientPickerOpen(false);
      setEditorOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load note");
    } finally {
      setEditorBusy(false);
    }
  }

  async function saveDraft(): Promise<string | null> {
    if (!draftPatientId.trim()) {
      setError("Select a patient.");
      return null;
    }
    if (!notesAuthorId) {
      setError("Missing user context (author).");
      return null;
    }
    setEditorBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        patient_id: draftPatientId.trim(),
        clinic_id: clinicId,
        author_id: notesAuthorId,
        note_type: draftNoteType,
        subjective: draftSubjective.trim() || null,
        objective: draftObjective.trim() || null,
        assessment: draftAssessment.trim() || null,
        plan: draftPlan.trim() || null,
      };
      if (draftSupervisingPtId.trim()) {
        body.supervising_pt_id = draftSupervisingPtId.trim();
      }

      if (editingId) {
        const res = await fetch(
          `${API_BASE}/api/clinical-notes/${encodeURIComponent(editingId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subjective: body.subjective,
              objective: body.objective,
              assessment: body.assessment,
              plan: body.plan,
              supervising_pt_id: body.supervising_pt_id ?? null,
              note_type: draftNoteType,
            }),
          },
        );
        if (!res.ok) {
          setError(await res.text().catch(() => res.statusText));
          return null;
        }
        await loadMyNotes();
        return editingId;
      }

      const res = await fetch(`${API_BASE}/api/clinical-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return null;
      }
      const created = (await res.json()) as ClinicalNote;
      const newId = created.id;
      setEditingId(newId);
      await loadMyNotes();
      return newId;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return null;
    } finally {
      setEditorBusy(false);
    }
  }

  async function submitForAiReview() {
    const id = await saveDraft();
    if (!id) return;
    setEditorBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(id)}/submit`,
        { method: "POST" },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setEditorOpen(false);
      resetEditor();
      await loadMyNotes();
      void refreshPendingReviewCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setEditorBusy(false);
    }
  }

  async function openViewNote(note: ClinicalNote) {
    setViewLoading(true);
    setViewNote(note);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(note.id)}`,
      );
      if (res.ok) {
        setViewNote((await res.json()) as ClinicalNote);
      }
    } catch {
      /* keep list row data */
    } finally {
      setViewLoading(false);
    }
  }

  async function signReviewNote() {
    if (!reviewNote) return;
    setReviewBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(reviewNote.id)}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signed_by: signedByCandidate }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setToast("Note signed successfully");
      setReviewNote(null);
      await loadReviewData();
      void refreshPendingReviewCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign failed");
    } finally {
      setReviewBusy(false);
    }
  }

  async function sendCorrectionRequest() {
    if (!reviewNote) return;
    const notes = correctionNotes.trim();
    if (!notes) {
      setError("Enter correction notes.");
      return;
    }
    setReviewBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(reviewNote.id)}/request-correction`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ correction_notes: notes }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setToast("Correction requested");
      setReviewNote(null);
      setCorrectionNotes("");
      setShowCorrectionField(false);
      await loadReviewData();
      void refreshPendingReviewCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setReviewBusy(false);
    }
  }

  const filteredPatients = useMemo(() => {
    const q = patientInputValue.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      patientDisplayName(p).toLowerCase().includes(q),
    );
  }, [patients, patientInputValue]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!patientPickerOpen) return;
      const el = patientPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [patientPickerOpen]);

  useEffect(() => {
    if (!editorOpen || !editingId || !draftPatientId) return;
    const p = patients.find((x) => x.id === draftPatientId);
    if (p) setPatientInputValue(patientDisplayName(p));
  }, [editorOpen, editingId, draftPatientId, patients]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Clinical Notes</h1>
          <p className={DS_PAGE_SUBTITLE}>
            SOAP documentation, AI review, and PT sign-off
          </p>
        </div>
        {activeTab === "my" ? (
          <button
            type="button"
            onClick={openNewNote}
            className={`${DS_PRIMARY_BTN} inline-flex min-h-[44px] shrink-0 items-center justify-center px-4 py-2.5`}
          >
            + New Note
          </button>
        ) : null}
      </div>

      {diagnosticPrefillBannerVisible && !editorOpen ? (
        <div
          className="relative mt-6 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 pr-12 text-sm text-teal-950"
          role="status"
        >
          <p>
            SOAP fields pre-filled from diagnostic analysis — open a note to
            review before saving.
          </p>
          <button
            type="button"
            className="absolute right-1 top-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-teal-800 hover:bg-teal-100"
            aria-label="Dismiss"
            onClick={() => setDiagnosticPrefillBannerVisible(false)}
          >
            ✕
          </button>
        </div>
      ) : null}

      {toast ? (
        <p className="mt-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          {toast}
        </p>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div
        className={`${DS_CARD} mt-8 flex flex-wrap gap-2 p-2`}
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "my"}
          onClick={() => setActiveTab("my")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "my"
              ? "bg-[var(--color-primary,#16A34A)] text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          My Notes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "review"}
          onClick={() => setActiveTab("review")}
          className={`relative rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "review"
              ? "bg-[var(--color-primary,#16A34A)] text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          Review Queue
          {pendingReviewCount > 0 ? (
            <span className="ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-semibold text-white tabular-nums">
              {pendingReviewCount}
            </span>
          ) : null}
        </button>
      </div>

      {activeTab === "my" ? (
        <div className="mt-8 space-y-8">
          <section className="max-w-3xl">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
              AI Scribe
            </h3>
            <p className="mt-1 text-xs text-gray-500 sm:text-sm">
              Record a visit to draft SOAP sections; then review and save in a
              new note.
            </p>
            <div className="mt-4 max-w-xl">
              <AmbientScribe
                clinicId={clinicId}
                onSoapGenerated={handleSoapFromScribe}
              />
            </div>
            <div
              className="mt-8 border-b border-gray-200"
              aria-hidden
            />
          </section>

          <div className={DS_TABLE_WRAP}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className={DS_TABLE_HEAD}>
                  <tr>
                    <th className={DS_TH}>Patient</th>
                    <th className={DS_TH}>Type</th>
                    <th className={DS_TH}>Status</th>
                    <th className={DS_TH}>Created</th>
                    <th className={`${DS_TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingMy ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-8 text-center text-gray-500"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : myNotes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-8 text-center text-gray-500"
                      >
                        {!notesAuthorId
                          ? "Could not resolve your user id. Try reloading the page."
                          : "No notes yet. Create a new note to get started."}
                      </td>
                    </tr>
                  ) : (
                    myNotes.map((n) => {
                      const st = (n.status ?? "").toLowerCase();
                      const pending = st === "ai_review_pending";
                      return (
                        <tr key={n.id} className={DS_TR}>
                          <td className={DS_TD_PRIMARY}>
                            {n.patient_name?.trim() || "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {noteTypeLabel(n.note_type)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <span className="inline-flex items-center gap-2">
                              {pending ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                              ) : null}
                              <span
                                className={clinicalNoteStatusBadgeClass(st)}
                              >
                                {clinicalNoteStatusLabel(st)}
                              </span>
                            </span>
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {formatNoteDate(n.created_at)}
                          </td>
                          <td className={`${DS_TD_PRIMARY} text-right`}>
                            {canEditNote(n.status) ? (
                              <button
                                type="button"
                                onClick={() => void openEditorForNote(n)}
                                className={`${DS_SECONDARY_BTN} mr-2`}
                              >
                                Edit
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void openViewNote(n)}
                              className={DS_SECONDARY_BTN}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
              Pending signature
            </h2>
            <div className={DS_TABLE_WRAP}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className={DS_TABLE_HEAD}>
                    <tr>
                      <th className={DS_TH}>Patient</th>
                      <th className={DS_TH}>Type</th>
                      <th className={DS_TH}>Author</th>
                      <th className={DS_TH}>Created</th>
                      <th className={`${DS_TH} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingReview ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-8 text-center text-gray-500"
                        >
                          Loading…
                        </td>
                      </tr>
                    ) : reviewQueue.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-8 text-center text-gray-500"
                        >
                          No notes awaiting review.
                        </td>
                      </tr>
                    ) : (
                      reviewQueue.map((n) => (
                        <tr key={n.id} className={DS_TR}>
                          <td className={DS_TD_PRIMARY}>
                            {n.patient_name?.trim() || "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {noteTypeLabel(n.note_type)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {n.author_name?.trim() || "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {formatNoteDate(n.created_at)}
                          </td>
                          <td className={`${DS_TD_PRIMARY} text-right`}>
                            <button
                              type="button"
                              onClick={() => {
                                setReviewNote(n);
                                setCorrectionNotes("");
                                setShowCorrectionField(false);
                              }}
                              className={DS_PRIMARY_BTN}
                            >
                              Review
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
              Recently signed
            </h2>
            <div className={DS_TABLE_WRAP}>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className={DS_TABLE_HEAD}>
                    <tr>
                      <th className={DS_TH}>Patient</th>
                      <th className={DS_TH}>Type</th>
                      <th className={DS_TH}>Author</th>
                      <th className={DS_TH}>Signed</th>
                      <th className={`${DS_TH} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signedRecent.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-6 py-8 text-center text-gray-500"
                        >
                          No signed notes yet.
                        </td>
                      </tr>
                    ) : (
                      signedRecent.map((n) => (
                        <tr key={n.id} className={DS_TR}>
                          <td className={DS_TD_PRIMARY}>
                            {n.patient_name?.trim() || "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {noteTypeLabel(n.note_type)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {n.author_name?.trim() || "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {formatNoteDate(n.signed_at ?? n.updated_at)}
                          </td>
                          <td className={`${DS_TD_PRIMARY} text-right`}>
                            <button
                              type="button"
                              onClick={() => void openViewNote(n)}
                              className={DS_SECONDARY_BTN}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Note editor */}
      {editorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className={`max-h-[95vh] w-full max-w-2xl overflow-y-auto ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="cn-editor-title"
          >
            <h2
              id="cn-editor-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              {editingId ? "Edit clinical note" : "New clinical note"}
            </h2>
            {scribeBannerVisible ? (
              <div
                className="relative mt-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 pr-12 text-sm text-sky-950"
                role="status"
              >
                <p>
                  Note generated from session recording. Please review before
                  submitting.
                </p>
                <button
                  type="button"
                  className="absolute right-1 top-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-sky-800 hover:bg-sky-100"
                  aria-label="Dismiss"
                  onClick={() => setScribeBannerVisible(false)}
                >
                  ✕
                </button>
              </div>
            ) : null}
            {diagnosticPrefillBannerVisible ? (
              <div
                className="relative mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 pr-12 text-sm text-teal-950"
                role="status"
              >
                <p>
                  SOAP fields pre-filled from diagnostic analysis — review before
                  saving.
                </p>
                <button
                  type="button"
                  className="absolute right-1 top-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-teal-800 hover:bg-teal-100"
                  aria-label="Dismiss"
                  onClick={() => setDiagnosticPrefillBannerVisible(false)}
                >
                  ✕
                </button>
              </div>
            ) : null}
            <div className="space-y-4 pt-5">
              <div className="relative" ref={patientPickerRef}>
                <label className="block text-sm font-medium text-gray-700">
                  Patient
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={patientInputValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPatientInputValue(v);
                    setDraftPatientId("");
                    setDraftAppointmentId("");
                    setPatientPickerOpen(true);
                  }}
                  onFocus={() => {
                    if (!editingId) setPatientPickerOpen(true);
                  }}
                  placeholder="Search and select a patient…"
                  className={`mt-1 h-9 ${DS_INPUT}`}
                  disabled={Boolean(editingId)}
                />
                {!editingId && patientPickerOpen ? (
                  <div
                    className="absolute left-0 right-0 z-20 mt-1 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
                    style={{ minHeight: 200, maxHeight: 300 }}
                  >
                    {filteredPatients.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-gray-500">
                        No matching patients.
                      </div>
                    ) : (
                      <ul className="py-1">
                        {filteredPatients.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2.5 text-left text-sm text-gray-900 hover:bg-gray-50"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setDraftPatientId(p.id);
                                setPatientInputValue(patientDisplayName(p));
                                setPatientPickerOpen(false);
                              }}
                            >
                              {patientDisplayName(p)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
                {!editingId ? (
                  <p className="mt-1 text-xs text-gray-500">
                    Type to filter, then click a name to select.
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">
                    Patient cannot be changed for an existing note.
                  </p>
                )}
              </div>
              <label className="block text-sm font-medium text-gray-700">
                Note type
                <select
                  value={draftNoteType}
                  onChange={(e) => setDraftNoteType(e.target.value)}
                  className={`mt-1 h-9 ${DS_INPUT}`}
                >
                  {NOTE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Supervising PT (UUID)
                <input
                  type="text"
                  value={draftSupervisingPtId}
                  onChange={(e) => setDraftSupervisingPtId(e.target.value)}
                  placeholder="Optional — clinician id"
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Subjective — what the patient reports
                <textarea
                  value={draftSubjective}
                  onChange={(e) => setDraftSubjective(e.target.value)}
                  rows={5}
                  className={`mt-1 min-h-[120px] ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Objective — measurable findings
                <textarea
                  value={draftObjective}
                  onChange={(e) => setDraftObjective(e.target.value)}
                  rows={5}
                  className={`mt-1 min-h-[120px] ${DS_INPUT}`}
                />
              </label>
              {draftAppointmentId.trim() ? (
                <MeasurementModule
                  appointmentId={draftAppointmentId.trim()}
                  clinicId={MEASUREMENT_CLINIC_ID}
                />
              ) : null}
              <label className="block text-sm font-medium text-gray-700">
                Assessment — clinical reasoning
                <textarea
                  value={draftAssessment}
                  onChange={(e) => setDraftAssessment(e.target.value)}
                  rows={5}
                  className={`mt-1 min-h-[120px] ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Plan — specific interventions
                <textarea
                  value={draftPlan}
                  onChange={(e) => setDraftPlan(e.target.value)}
                  rows={5}
                  className={`mt-1 min-h-[120px] ${DS_INPUT}`}
                />
              </label>
              {editingId && clinicId ? (
                <CptDetectionPanel
                  noteId={editingId}
                  clinicId={clinicId}
                  initialCodes={draftCptCodes}
                  onCodesDetected={setDraftCptCodes}
                />
              ) : null}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => {
                  setEditorOpen(false);
                  resetEditor();
                }}
                className={`${DS_SECONDARY_BTN} min-h-[44px] px-4 py-2.5`}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editorBusy}
                onClick={() => void saveDraft()}
                className={`${DS_SECONDARY_BTN} min-h-[44px] px-4 py-2.5 disabled:opacity-60`}
              >
                {editorBusy ? "Saving…" : "Save Draft"}
              </button>
              <button
                type="button"
                disabled={editorBusy}
                onClick={() => void submitForAiReview()}
                className={`${DS_PRIMARY_BTN} min-h-[44px] px-4 py-2.5 disabled:opacity-60`}
              >
                {editorBusy ? "Working…" : "Submit for AI Review"}
              </button>
            </div>

            {sessionTranscript ? (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50 sm:text-base"
                  onClick={() => setTranscriptPanelOpen((o) => !o)}
                  aria-expanded={transcriptPanelOpen}
                >
                  <span>View Transcript</span>
                  <span className="text-gray-500" aria-hidden>
                    {transcriptPanelOpen ? "▲" : "▼"}
                  </span>
                </button>
                {transcriptPanelOpen ? (
                  <pre
                    className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800 whitespace-pre-wrap sm:text-sm"
                  >
                    {sessionTranscript}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* View detail (PTA + shared) */}
      {viewNote ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewNote(null);
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
                  {viewNote.patient_name?.trim() || "Patient"}
                </h2>
                <p className="text-sm text-gray-500">
                  {noteTypeLabel(viewNote.note_type)} ·{" "}
                  <span className={clinicalNoteStatusBadgeClass(viewNote.status ?? "")}>
                    {clinicalNoteStatusLabel((viewNote.status ?? "").toLowerCase())}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewNote(null)}
                className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            {viewLoading ? (
              <p className="mt-4 text-sm text-gray-500">Refreshing…</p>
            ) : null}

            {(viewNote.status ?? "").toLowerCase() === "ready_for_review" ? (
              <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
                Note passed review and is ready for PT signature
              </div>
            ) : null}

            {(viewNote.status ?? "").toLowerCase() === "ai_flagged" ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                <p className="font-medium">AI feedback</p>
                <p className="mt-1 whitespace-pre-wrap">
                  {viewNote.ai_feedback?.trim() || "—"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setViewNote(null);
                    void openEditorForNote(viewNote);
                  }}
                  className={`${DS_SECONDARY_BTN} mt-3`}
                >
                  Edit Note
                </button>
              </div>
            ) : null}

            {(viewNote.status ?? "").toLowerCase() === "needs_correction" ? (
              <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                <p className="font-medium">Supervising PT requested corrections</p>
                <p className="mt-1 whitespace-pre-wrap">
                  {viewNote.correction_notes?.trim() || "—"}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setViewNote(null);
                    void openEditorForNote(viewNote);
                  }}
                  className={`${DS_SECONDARY_BTN} mt-3`}
                >
                  Edit Note
                </button>
              </div>
            ) : null}

            <div className="mt-6 space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">
                  Subjective
                </p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {viewNote.subjective?.trim() || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">
                  Objective
                </p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {viewNote.objective?.trim() || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">
                  Assessment
                </p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {viewNote.assessment?.trim() || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">Plan</p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {viewNote.plan?.trim() || "—"}
                </p>
              </div>
            </div>
            <p className="mt-6 border-t border-gray-100 pt-4 text-xs text-gray-500">
              Created {formatNoteDate(viewNote.created_at)}
              {viewNote.author_name ? ` · ${viewNote.author_name}` : ""}
            </p>
          </div>
        </div>
      ) : null}

      {/* PT Review modal */}
      {reviewNote ? (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReviewNote(null);
          }}
          role="presentation"
        >
          <div
            className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto ${DS_CARD}`}
            role="dialog"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-gray-100 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {reviewNote.patient_name?.trim() || "Patient"}
                </h2>
                <p className="text-sm text-gray-500">
                  {noteTypeLabel(reviewNote.note_type)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewNote(null)}
                className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="mt-6 space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">
                  Subjective
                </p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {reviewNote.subjective?.trim() || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">
                  Objective
                </p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {reviewNote.objective?.trim() || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">
                  Assessment
                </p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {reviewNote.assessment?.trim() || "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-gray-500">Plan</p>
                <p className="mt-1 whitespace-pre-wrap text-gray-900">
                  {reviewNote.plan?.trim() || "—"}
                </p>
              </div>
            </div>

            <p className="mt-6 text-xs text-gray-500">
              Author: {reviewNote.author_name?.trim() || "—"} · Submitted{" "}
              {formatNoteDate(reviewNote.created_at)}
            </p>

            {showCorrectionField ? (
              <label className="mt-6 block text-sm font-medium text-gray-700">
                Correction notes
                <textarea
                  value={correctionNotes}
                  onChange={(e) => setCorrectionNotes(e.target.value)}
                  rows={4}
                  className={`mt-1 ${DS_INPUT}`}
                  placeholder="Describe what the PTA should change…"
                />
              </label>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3 border-t border-gray-100 pt-6">
              <button
                type="button"
                disabled={reviewBusy}
                onClick={() => void signReviewNote()}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {reviewBusy ? "Signing…" : "Sign Note"}
              </button>
              {!showCorrectionField ? (
                <button
                  type="button"
                  disabled={reviewBusy}
                  onClick={() => setShowCorrectionField(true)}
                  className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-900 hover:bg-orange-100 disabled:opacity-60"
                >
                  Request Correction
                </button>
              ) : (
                <button
                  type="button"
                  disabled={reviewBusy}
                  onClick={() => void sendCorrectionRequest()}
                  className="rounded-lg border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-900 hover:bg-orange-100 disabled:opacity-60"
                >
                  {reviewBusy ? "Sending…" : "Submit correction request"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

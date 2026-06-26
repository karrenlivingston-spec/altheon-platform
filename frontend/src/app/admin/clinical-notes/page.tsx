"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Filter, Mic, Search, X } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";

import { useClinic } from "@/app/admin/ClinicContext";
import { supabase } from "@/lib/supabase";
import {
  AmbientScribe,
  type ScribeSpecialTestResult,
  type SoapFromScribe,
} from "@/components/clinical-notes/AmbientScribe";
import {
  MeasurementModule,
  type ExtractedMeasurements,
  type MeasurementModuleHandle,
} from "@/components/clinical-notes/MeasurementModule";
import { SpecialTestsSection } from "@/components/clinical-notes/SpecialTestsSection";
import CptDetectionPanel, {
  type CptCode,
} from "@/components/CptDetectionPanel";
import PayerOptimizerPanel from "@/components/soap/PayerOptimizerPanel";
import PlanOfCareModal from "@/components/clinical-notes/PlanOfCareModal";
import ClinicalNotesStatCards from "@/components/admin/clinical-notes/ClinicalNotesStatCards";
import ClinicalNotesFilterTabs from "@/components/admin/clinical-notes/ClinicalNotesFilterTabs";
import ClinicalNotesSidebar from "@/components/admin/clinical-notes/ClinicalNotesSidebar";
import ClinicalNotesTable from "@/components/admin/clinical-notes/ClinicalNotesTable";
import ClinicalNotesInsights from "@/components/admin/clinical-notes/ClinicalNotesInsights";
import ClinicalNoteGoalsSection from "@/components/admin/clinical-notes/ClinicalNoteGoalsSection";
import {
  ClinicalNoteListItem,
  ClinicalNotesStats,
  FilterTab,
  ScopeTab,
  SidebarFilters,
  defaultSidebarFilters,
  formatNoteDateTime,
  noteTypeLabel,
} from "@/components/admin/clinical-notes/clinicalNotesTypes";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const UPCOMING_APPOINTMENT_STATUSES = new Set(["scheduled", "confirmed"]);

type AppointmentListRow = {
  id: string;
  patient_id?: string;
  start_time?: string;
  status?: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return headers;
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
  insurance_carrier?: string | null;
};

const PAYER_CPT_DESCRIPTIONS: Record<string, string> = {
  "97161": "PT Eval Low",
  "97162": "PT Eval Mod",
  "97163": "PT Eval High",
  "97164": "PT Re-Eval",
  "97110": "Therapeutic Ex",
  "97112": "Neuromusc Re-ed",
  "97530": "Therapeutic Act",
  "97140": "Manual Therapy",
  "97010": "Hot/Cold Pack",
  "97014": "E-Stim (Unatt.)",
  G0283: "E-Stim (Medicare)",
};

function payerCodesToCptCodes(codes: string[]): CptCode[] {
  return codes.map((cpt_code) => ({
    cpt_code,
    description: PAYER_CPT_DESCRIPTIONS[cpt_code] ?? cpt_code,
    charge: 0,
    modifiers: [],
    reason: "Selected from payer billing optimizer",
  }));
}

type ClinicalNote = ClinicalNoteListItem;

const NOTE_TYPE_OPTIONS = [
  { value: "daily_note", label: "Daily Note" },
  { value: "initial_evaluation", label: "Initial Evaluation" },
  { value: "progress_note", label: "Progress Note" },
  { value: "discharge_note", label: "Discharge Note" },
] as const;

const EDITOR_TABS = [
  { id: 1, label: "Capture" },
  { id: 2, label: "SOAP Review" },
  { id: 3, label: "Special Tests" },
  { id: 4, label: "Billing" },
  { id: 5, label: "AI Review" },
  { id: 6, label: "Sign & Submit" },
] as const;

function truncateSummary(text: string, max = 120): string {
  const t = text.trim();
  if (!t) return "—";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function showSpecialTestsForNoteType(noteType: string | null | undefined): boolean {
  return (noteType ?? "").trim().toLowerCase() !== "daily_note";
}

function isEvaluationNoteType(noteType: string | null | undefined): boolean {
  return (noteType ?? "").toLowerCase().includes("evaluation");
}

function patientDisplayName(p: PatientRow): string {
  const s = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return s || "—";
}

function formatNoteDate(iso: string | null | undefined): string {
  return formatNoteDateTime(iso).date;
}

function canEditNote(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return (
    s === "draft" || s === "ai_flagged" || s === "needs_correction"
  );
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

export default function AdminClinicalNotesPage() {
  const { clinic_id: clinicId, me } = useClinic();
  const supabaseUserId = (me?.user_id ?? "").trim();
  /** clinical_notes.author_id is clinic_users.id; /me exposes clinic_user_id for list/save. */
  const notesAuthorId = (me?.clinic_user_id ?? "").trim() || supabaseUserId;
  const signedByCandidate = supabaseUserId || clinicId;

  const [scopeTab, setScopeTab] = useState<ScopeTab>("my");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarFilters, setSidebarFilters] = useState<SidebarFilters>(
    defaultSidebarFilters(),
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [stats, setStats] = useState<ClinicalNotesStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [notesLoading, setNotesLoading] = useState(true);
  const [clinicians, setClinicians] = useState<Array<{ id: string; name: string }>>(
    [],
  );

  const [patients, setPatients] = useState<PatientRow[]>([]);
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
  const [editorTab, setEditorTab] = useState(1);
  const [draftNoteStatus, setDraftNoteStatus] = useState("draft");
  const [draftAiFeedback, setDraftAiFeedback] = useState("");
  const [optimizerVisitType, setOptimizerVisitType] = useState<
    "initial" | "followup"
  >("followup");

  const [viewNote, setViewNote] = useState<ClinicalNote | null>(null);
  const [pocNote, setPocNote] = useState<ClinicalNote | null>(null);
  const [pocLiveSoap, setPocLiveSoap] = useState<{
    subjectiveText?: string;
    assessmentText?: string;
    planText?: string;
  } | null>(null);
  const [exportingNoteId, setExportingNoteId] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [reviewNote, setReviewNote] = useState<ClinicalNote | null>(null);
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [showCorrectionField, setShowCorrectionField] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [signAnywayBusy, setSignAnywayBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [infoToast, setInfoToast] = useState<string | null>(null);
  /** Special tests detected by the scribe before the note exists; flushed on first save. */
  const pendingScribeTestsRef = useRef<ScribeSpecialTestResult[]>([]);
  const measurementModuleRef = useRef<MeasurementModuleHandle>(null);
  const appointmentDeepLinkRef = useRef(false);
  const preservedAppointmentIdRef = useRef<string | null>(null);
  const [measurementPrefill, setMeasurementPrefill] =
    useState<ExtractedMeasurements | null>(null);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  const [scribeBannerVisible, setScribeBannerVisible] = useState(false);
  const [scribePanelOpen, setScribePanelOpen] = useState(true);
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

  const handleSoapFromScribe = useCallback(
    (soap: SoapFromScribe) => {
      setDraftSubjective(soap.subjective);
      setDraftObjective(soap.objective);
      setDraftAssessment(soap.assessment);
      setDraftPlan(soap.plan);
      setSessionTranscript(soap.transcript);
      setScribeBannerVisible(true);
      setTranscriptPanelOpen(false);

      pendingScribeTestsRef.current = soap.special_test_results ?? [];
      const names = soap.auto_populated_special_tests ?? [];
      if (names.length > 0) {
        setInfoToast(
          `Special tests auto-detected: ${names.join(", ")} — review in Special Tests section`,
        );
      }

      const transcript = soap.transcript.trim();
      if (transcript && clinicId) {
        void (async () => {
          try {
            const res = await fetch(
              `${API_BASE}/api/clinical-notes/extract-measurements`,
              {
                method: "POST",
                headers: await authHeaders(),
                body: JSON.stringify({
                  transcript,
                  appointment_id: draftAppointmentId.trim(),
                  clinic_id: clinicId,
                  patient_id: draftPatientId.trim(),
                }),
              },
            );
            if (!res.ok) return;
            const data = (await res.json()) as ExtractedMeasurements;
            setMeasurementPrefill(data);
          } catch {
            /* keep existing measurement fields */
          }
        })();
      }
    },
    [clinicId, draftAppointmentId, draftPatientId],
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStats = useCallback(async () => {
    if (!clinicId) return;
    setStatsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/stats?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setStats(null);
        return;
      }
      const data = (await res.json()) as ClinicalNotesStats;
      setStats(data);
      setPendingReviewCount(data.needs_review ?? 0);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [clinicId]);

  const loadClinicians = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      const json = res.ok ? await res.json() : [];
      const rows = Array.isArray(json) ? json : [];
      setClinicians(
        rows.map((c: { id?: string; first_name?: string; last_name?: string }) => ({
          id: String(c.id ?? ""),
          name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Provider",
        })),
      );
    } catch {
      setClinicians([]);
    }
  }, [clinicId]);

  const loadNotes = useCallback(async () => {
    if (!clinicId) {
      setNotes([]);
      setTotalCount(0);
      setNotesLoading(false);
      return;
    }
    setNotesLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        clinic_id: clinicId,
        page: String(page),
        page_size: String(pageSize),
      });
      if (scopeTab === "my" && notesAuthorId) {
        params.set("author_id", notesAuthorId);
      }
      if (scopeTab === "review") {
        params.set("status", "ready_for_review");
      }
      if (filterTab === "needs_review") params.set("review_status", "needs_review");
      if (filterTab === "ai_generated") params.set("ai_generated", "true");
      if (filterTab === "provider_signed" || filterTab === "completed") {
        params.set("signature_status", "signed");
      }
      if (filterTab === "attorney_requested") {
        params.set("attorney_requested", "true");
      }
      if (sidebarFilters.dateFrom) params.set("date_from", sidebarFilters.dateFrom);
      if (sidebarFilters.dateTo) params.set("date_to", sidebarFilters.dateTo);
      if (sidebarFilters.clinicianId) {
        params.set("clinician_id", sidebarFilters.clinicianId);
      }
      if (sidebarFilters.aiStatus === "generated") params.set("ai_generated", "true");
      if (sidebarFilters.aiStatus === "not_generated") {
        params.set("ai_generated", "false");
      }
      if (sidebarFilters.reviewStatus) {
        params.set("review_status", sidebarFilters.reviewStatus);
      }
      if (sidebarFilters.noteTypes.length === 1) {
        params.set("note_type", sidebarFilters.noteTypes[0]);
      }
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());

      const res = await fetch(
        `${API_BASE}/api/clinical-notes?${params.toString()}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => `HTTP ${res.status}`));
        setNotes([]);
        setTotalCount(0);
        return;
      }
      const json = (await res.json()) as {
        notes?: ClinicalNote[];
        total_count?: number;
      };
      let list = Array.isArray(json.notes) ? json.notes : [];
      if (sidebarFilters.noteTypes.length > 1) {
        const allowed = new Set(sidebarFilters.noteTypes);
        list = list.filter((n) => allowed.has(String(n.note_type ?? "")));
      }
      setNotes(list);
      setTotalCount(json.total_count ?? list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notes");
      setNotes([]);
      setTotalCount(0);
    } finally {
      setNotesLoading(false);
    }
  }, [
    clinicId,
    scopeTab,
    filterTab,
    page,
    pageSize,
    notesAuthorId,
    sidebarFilters,
    debouncedSearch,
  ]);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([loadStats(), loadNotes()]);
  }, [loadStats, loadNotes]);

  const loadPatients = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      const json = res.ok ? await res.json() : [];
      setPatients(Array.isArray(json) ? json : []);
    } catch {
      setPatients([]);
    }
  }, [clinicId]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [scopeTab, filterTab, sidebarFilters, debouncedSearch, pageSize]);

  useEffect(() => {
    void loadPatients();
    void loadClinicians();
    void loadStats();
  }, [loadPatients, loadClinicians, loadStats]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const hasPendingAi = useMemo(
    () =>
      notes.some(
        (n) => (n.status ?? "").toLowerCase() === "ai_review_pending",
      ),
    [notes],
  );

  useEffect(() => {
    if (scopeTab !== "my" || !hasPendingAi) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = setInterval(() => {
      void loadNotes();
    }, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scopeTab, hasPendingAi, loadNotes]);

  const resolveAppointmentForPatient = useCallback(async (patientId: string) => {
    const pid = patientId.trim();
    if (!pid) {
      setDraftAppointmentId("");
      return;
    }
    try {
      const params = new URLSearchParams({
        clinic_id: clinicId,
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
  }, [clinicId]);

  useEffect(() => {
    if (appointmentDeepLinkRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const appointmentId = params.get("appointment_id")?.trim() ?? "";
    const patientId = params.get("patient_id")?.trim() ?? "";
    if (!appointmentId && !patientId) return;
    appointmentDeepLinkRef.current = true;
    if (appointmentId) {
      preservedAppointmentIdRef.current = appointmentId;
    }

    setEditingId(null);
    setDraftNoteType("daily_note");
    setDraftSupervisingPtId("");
    setDraftSubjective("");
    setDraftObjective("");
    setDraftAssessment("");
    setDraftPlan("");
    setDraftCptCodes(null);
    setEditorTab(1);
    setDraftNoteStatus("draft");
    setDraftAiFeedback("");
    setScribeBannerVisible(false);
    setSessionTranscript("");
    setTranscriptPanelOpen(false);
    setMeasurementPrefill(null);
    pendingScribeTestsRef.current = [];

    if (patientId) {
      setDraftPatientId(patientId);
      const picked = patients.find((x) => x.id === patientId);
      setPatientInputValue(
        picked ? patientDisplayName(picked) : "Patient",
      );
    } else {
      setDraftPatientId("");
      setPatientInputValue("");
    }
    setDraftAppointmentId(appointmentId);
    setPatientPickerOpen(false);
    setEditorOpen(true);
    setScribePanelOpen(true);
    window.history.replaceState(null, "", "/admin/clinical-notes");
  }, [patients]);

  useEffect(() => {
    if (!editorOpen || editingId) return;
    const pid = draftPatientId.trim();
    if (!pid) {
      setDraftAppointmentId("");
      return;
    }
    if (preservedAppointmentIdRef.current) {
      setDraftAppointmentId(preservedAppointmentIdRef.current);
      preservedAppointmentIdRef.current = null;
      return;
    }
    void resolveAppointmentForPatient(pid);
  }, [editorOpen, editingId, draftPatientId, resolveAppointmentForPatient]);

  const resolveVisitTypeForPatient = useCallback(
    async (patientId: string) => {
      const pid = patientId.trim();
      if (!pid || !clinicId) {
        setOptimizerVisitType("followup");
        return;
      }
      try {
        const params = new URLSearchParams({
          clinic_id: clinicId,
          patient_id: pid,
        });
        const res = await fetch(`${API_BASE}/appointments?${params.toString()}`, {
          headers: await authHeaders(),
        });
        if (!res.ok) {
          setOptimizerVisitType("followup");
          return;
        }
        const data: unknown = await res.json();
        const rows = Array.isArray(data) ? (data as AppointmentListRow[]) : [];
        const completed = rows.filter(
          (r) => normalizeAppointmentStatus(r.status) === "completed",
        );
        setOptimizerVisitType(completed.length === 0 ? "initial" : "followup");
      } catch {
        setOptimizerVisitType("followup");
      }
    },
    [clinicId],
  );

  useEffect(() => {
    if (!editorOpen) return;
    const pid = draftPatientId.trim();
    if (!pid) {
      setOptimizerVisitType("followup");
      return;
    }
    void resolveVisitTypeForPatient(pid);
  }, [editorOpen, draftPatientId, resolveVisitTypeForPatient]);

  const draftPatientPrimaryPayer = useMemo(() => {
    const p = patients.find((x) => x.id === draftPatientId);
    return p?.insurance_carrier?.trim() || null;
  }, [patients, draftPatientId]);

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
    setEditorTab(1);
    setDraftNoteStatus("draft");
    setDraftAiFeedback("");
    setPatientInputValue("");
    setPatientPickerOpen(false);
    setScribeBannerVisible(false);
    setSessionTranscript("");
    setTranscriptPanelOpen(false);
    setMeasurementPrefill(null);
    pendingScribeTestsRef.current = [];
  }

  function closeEditor() {
    setEditorOpen(false);
    resetEditor();
  }

  function openNewNote() {
    resetEditor();
    setEditorTab(1);
    setScribePanelOpen(true);
    setEditorOpen(true);
  }

  async function openEditorForNote(note: ClinicalNote) {
    setEditorBusy(true);
    setError(null);
    setScribePanelOpen(false);
    setScribeBannerVisible(false);
    setSessionTranscript("");
    setTranscriptPanelOpen(false);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(note.id)}`,
        { headers: await authHeaders() },
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
        Array.isArray(row.cpt_codes_detected)
          ? (row.cpt_codes_detected as CptCode[])
          : null,
      );
      setDraftNoteStatus((row.status ?? "draft").toLowerCase());
      setDraftAiFeedback(row.ai_feedback ?? "");
      setEditorTab(1);
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

  async function flushPendingScribeTests(noteId: string) {
    const pending = pendingScribeTestsRef.current;
    if (pending.length === 0) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(noteId)}/special-tests?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            results: pending.map((p) => ({
              test_id: p.test_id,
              result: p.result,
              clinician_notes: p.clinician_notes,
            })),
          }),
        },
      );
      if (res.ok) {
        pendingScribeTestsRef.current = [];
      }
    } catch {
      /* keep pending for the next save attempt */
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
      if (draftAppointmentId.trim()) {
        body.appointment_id = draftAppointmentId.trim();
      }

      if (editingId) {
        const res = await fetch(
          `${API_BASE}/api/clinical-notes/${encodeURIComponent(editingId)}`,
          {
            method: "PATCH",
            headers: await authHeaders(),
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
        await flushPendingScribeTests(editingId);
        if (draftAppointmentId.trim()) {
          await measurementModuleRef.current?.save();
        }
        await refreshDashboard();
        return editingId;
      }

      const res = await fetch(`${API_BASE}/api/clinical-notes`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return null;
      }
      const created = (await res.json()) as ClinicalNote;
      const newId = created.id;
      setEditingId(newId);
      await flushPendingScribeTests(newId);
      if (draftAppointmentId.trim()) {
        await measurementModuleRef.current?.save();
      }
      await refreshDashboard();
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
        { method: "POST", headers: await authHeaders() },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      const updated = (await res.json()) as ClinicalNote;
      setDraftNoteStatus((updated.status ?? "draft").toLowerCase());
      setDraftAiFeedback(updated.ai_feedback ?? "");
      setEditorOpen(false);
      resetEditor();
      await refreshDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setEditorBusy(false);
    }
  }

  async function exportNotePdf(note: ClinicalNote) {
    setExportingNoteId(note.id);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(note.id)}/pdf?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const patient = (note.patient_name ?? "patient")
        .trim()
        .replace(/[^\w\- ]+/g, "")
        .replace(/\s+/g, "_");
      const date = (note.signed_at ?? note.created_at ?? "").slice(0, 10);
      a.download = `${patient || "patient"}_${note.note_type ?? "note"}_${date}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingNoteId(null);
    }
  }

  async function openViewNote(note: ClinicalNote) {
    setViewLoading(true);
    setViewNote(note);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(note.id)}`,
        { headers: await authHeaders() },
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
          headers: await authHeaders(),
          body: JSON.stringify({ signed_by: signedByCandidate }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setToast("Note signed successfully");
      setReviewNote(null);
      await refreshDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign failed");
    } finally {
      setReviewBusy(false);
    }
  }

  async function signAnywayFromEditor() {
    if (!editingId) return;
    const confirmed = window.confirm(
      "This note was flagged by AI review. Sign anyway? This will be recorded on the note for audit purposes.",
    );
    if (!confirmed) return;

    setSignAnywayBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(editingId)}/sign`,
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ signed_by: signedByCandidate }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setToast("Note signed successfully");
      setEditorOpen(false);
      resetEditor();
      await refreshDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign failed");
    } finally {
      setSignAnywayBusy(false);
    }
  }

  async function signAnyway(note: ClinicalNote) {
    const confirmed = window.confirm(
      "This note was flagged by AI review. Sign anyway? This will be recorded on the note for audit purposes.",
    );
    if (!confirmed) return;

    setSignAnywayBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/clinical-notes/${encodeURIComponent(note.id)}/sign`,
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({ signed_by: signedByCandidate }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setToast("Note signed successfully");
      setViewNote(null);
      await refreshDashboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign failed");
    } finally {
      setSignAnywayBusy(false);
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
          headers: await authHeaders(),
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
      await refreshDashboard();
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

  useEffect(() => {
    if (!infoToast) return;
    const t = window.setTimeout(() => setInfoToast(null), 8000);
    return () => window.clearTimeout(t);
  }, [infoToast]);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Clinical Notes</h1>
          <p className={DS_PAGE_SUBTITLE}>
            SOAP documentation, AI review, and PT sign-off
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center xl:w-auto">
          <div className="relative min-w-0 flex-1 sm:min-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes by patient, type, or keyword..."
              className={`${DS_INPUT} w-full pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowSidebar((v) => !v)}
            className={`${DS_SECONDARY_BTN} inline-flex items-center gap-2`}
          >
            <Filter className="h-4 w-4" />
            Filters
          </button>
          <button
            type="button"
            onClick={openNewNote}
            className={`${DS_PRIMARY_BTN} inline-flex min-h-[44px] shrink-0 items-center justify-center px-4 py-2.5`}
          >
            + New Note
          </button>
        </div>
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

      {infoToast ? (
        <p className="mt-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {infoToast}
        </p>
      ) : null}

      {error ? (
        <p className="mt-6 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        <ClinicalNotesStatCards stats={stats} loading={statsLoading} />
      </div>

      <div className="mt-6">
        <ClinicalNotesFilterTabs
          active={filterTab}
          onChange={setFilterTab}
          counts={stats?.tab_counts}
        />
      </div>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 lg:w-3/4">
          <div
            className={`${DS_CARD} mb-4 flex flex-wrap gap-2 p-2`}
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={scopeTab === "my"}
              onClick={() => setScopeTab("my")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                scopeTab === "my"
                  ? "bg-[var(--color-primary,#16A34A)] text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              My Notes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scopeTab === "all"}
              onClick={() => setScopeTab("all")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                scopeTab === "all"
                  ? "bg-[var(--color-primary,#16A34A)] text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              All Clinic Notes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scopeTab === "review"}
              onClick={() => setScopeTab("review")}
              className={`relative rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                scopeTab === "review"
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

          {scopeTab === "my" && !notesAuthorId ? (
            <p className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Could not resolve your user id. Try reloading the page.
            </p>
          ) : null}

          <ClinicalNotesTable
            notes={notes}
            loading={notesLoading}
            totalCount={totalCount}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            onView={(n) => void openViewNote(n)}
            onEdit={(n) => void openEditorForNote(n)}
            onDownloadPdf={(n) => void exportNotePdf(n)}
            onReview={(n) => {
              setReviewNote(n);
              setCorrectionNotes("");
              setShowCorrectionField(false);
            }}
            exportingNoteId={exportingNoteId}
            canEdit={(n) => canEditNote(n.status)}
            scopeReview={scopeTab === "review"}
          />
        </div>

        {showSidebar ? (
          <div className="w-full shrink-0 lg:w-1/4">
            <ClinicalNotesSidebar
              filters={sidebarFilters}
              onChange={setSidebarFilters}
              clinicians={clinicians}
            />
          </div>
        ) : null}
      </div>

      <ClinicalNotesInsights stats={stats} onNewNote={openNewNote} />

      {/* Note editor — 6-tab workflow */}
      {editorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className={`flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="cn-editor-title"
          >
            <div className="shrink-0 border-b border-gray-100 pb-4">
              <div className="flex items-start justify-between gap-4">
                <h2
                  id="cn-editor-title"
                  className="text-lg font-semibold text-gray-900"
                >
                  {editingId ? "Edit clinical note" : "New clinical note"}
                </h2>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav
                className="mt-4 flex flex-wrap gap-1"
                aria-label="Editor steps"
              >
                {EDITOR_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setEditorTab(tab.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      editorTab === tab.id
                        ? "bg-[var(--color-primary,#16A34A)] text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pt-4">
              {editorTab === 1 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200">
                    <button
                      type="button"
                      onClick={() => setScribePanelOpen((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left hover:bg-gray-50"
                      aria-expanded={scribePanelOpen}
                    >
                      {scribePanelOpen ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                      <Mic className="h-4 w-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-700">
                        AI Scribe
                      </span>
                    </button>
                    {scribePanelOpen ? (
                      <div className="border-t border-gray-100 p-4">
                        <AmbientScribe
                          clinicId={clinicId}
                          patientId={draftPatientId || undefined}
                          noteId={editingId ?? undefined}
                          onSoapGenerated={handleSoapFromScribe}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 py-3 text-sm text-gray-600">
                    <p className="font-medium text-gray-800">Manual documentation</p>
                    <p className="mt-1 text-xs">
                      Skip AI Scribe and go to{" "}
                      <button
                        type="button"
                        onClick={() => setEditorTab(2)}
                        className="font-medium text-teal-700 underline hover:text-teal-800"
                      >
                        SOAP Review
                      </button>{" "}
                      to type Subjective, Objective, Assessment, and Plan by hand.
                    </p>
                  </div>

                  {scribeBannerVisible ? (
                    <div
                      className="relative rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 pr-12 text-sm text-sky-950"
                      role="status"
                    >
                      <p>
                        Note generated from session recording. Please review on
                        SOAP Review before submitting.
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
                      className="relative rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 pr-12 text-sm text-teal-950"
                      role="status"
                    >
                      <p>
                        SOAP fields pre-filled from diagnostic analysis — review on
                        SOAP Review before saving.
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
                    Appointment ID
                    <input
                      type="text"
                      value={draftAppointmentId}
                      onChange={(e) => setDraftAppointmentId(e.target.value)}
                      placeholder="Optional — links measurements when set"
                      className={`mt-1 ${DS_INPUT}`}
                    />
                  </label>

                  {sessionTranscript ? (
                    <div className="border-t border-gray-100 pt-4">
                      <button
                        type="button"
                        className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
                        onClick={() => setTranscriptPanelOpen((o) => !o)}
                        aria-expanded={transcriptPanelOpen}
                      >
                        <span>View Transcript</span>
                        <span className="text-gray-500" aria-hidden>
                          {transcriptPanelOpen ? "▲" : "▼"}
                        </span>
                      </button>
                      {transcriptPanelOpen ? (
                        <pre className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed whitespace-pre-wrap text-gray-800 sm:text-sm">
                          {sessionTranscript}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}

                  {draftAppointmentId.trim() ? (
                    <MeasurementModule
                      ref={measurementModuleRef}
                      appointmentId={draftAppointmentId.trim()}
                      clinicId={clinicId}
                      prefillData={measurementPrefill}
                      hideDictation
                      hideSaveButton
                    />
                  ) : (
                    <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-4 py-3 text-xs text-gray-600">
                      Select a patient to link an appointment before recording
                      smart measurements.
                    </p>
                  )}
                </div>
              ) : null}

              {editorTab === 2 ? (
                <div className="space-y-4">
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
                  <ClinicalNoteGoalsSection
                    noteId={editingId}
                    assessmentText={draftAssessment}
                    onError={setError}
                  />
                </div>
              ) : null}

              {editorTab === 3 ? (
                <div>
                  {showSpecialTestsForNoteType(draftNoteType) ? (
                    <SpecialTestsSection
                      noteId={editingId}
                      clinicId={clinicId}
                      onSaved={(m) => setToast(m)}
                    />
                  ) : (
                    <p className="text-sm text-gray-500">
                      Special tests are not used for daily notes. Change note type
                      on Capture if needed.
                    </p>
                  )}
                </div>
              ) : null}

              {editorTab === 4 ? (
                <div className="space-y-4">
                  <PayerOptimizerPanel
                    clinicId={clinicId}
                    appointmentId={draftAppointmentId.trim()}
                    primaryPayer={draftPatientPrimaryPayer}
                    secondaryPayer={null}
                    visitType={
                      draftNoteType.toLowerCase().includes("initial")
                        ? "initial"
                        : optimizerVisitType
                    }
                    onCodesSelected={(codes) => {
                      const incoming = payerCodesToCptCodes(codes);
                      setDraftCptCodes((prev) => {
                        const existing = prev ?? [];
                        const merged = [...existing];
                        for (const code of incoming) {
                          if (!merged.find((c) => c.cpt_code === code.cpt_code)) {
                            merged.push(code);
                          }
                        }
                        return merged;
                      });
                    }}
                  />
                  <CptDetectionPanel
                    noteId={editingId ?? ""}
                    clinicId={clinicId}
                    initialCodes={draftCptCodes ?? []}
                    onCodesDetected={setDraftCptCodes}
                  />
                  <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Plan of Care
                    </h3>
                    {draftNoteType.toLowerCase().includes("evaluation") &&
                    draftPatientId ? (
                      <button
                        type="button"
                        className={`mt-3 ${DS_SECONDARY_BTN}`}
                        onClick={() => {
                          setPocLiveSoap({
                            subjectiveText: draftSubjective,
                            assessmentText: draftAssessment,
                            planText: draftPlan,
                          });
                          setPocNote({
                            id: editingId ?? "",
                            patient_id: draftPatientId,
                            note_type: draftNoteType,
                            author_name: null,
                            subjective: draftSubjective,
                            assessment: draftAssessment,
                            plan: draftPlan,
                          });
                        }}
                      >
                        Open Plan of Care
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-gray-500">
                        Plan of Care is available for initial evaluation notes.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              {editorTab === 5 ? (
                <div className="space-y-4">
                  {draftNoteStatus === "ai_flagged" ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                      <p className="font-medium">AI feedback</p>
                      <p className="mt-1 whitespace-pre-wrap">
                        {draftAiFeedback.trim() || "—"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setEditorTab(2)}
                          className={DS_SECONDARY_BTN}
                        >
                          Edit Note
                        </button>
                        <button
                          type="button"
                          disabled={signAnywayBusy || !editingId}
                          onClick={() => void signAnywayFromEditor()}
                          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
                        >
                          {signAnywayBusy ? "Signing…" : "Sign Anyway"}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-red-700">
                        Signing anyway overrides the AI flag and will be recorded
                        on the note for review.
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
                        No AI review issues for this draft.
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              {editorTab === 6 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 text-sm">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Summary
                    </h3>
                    <dl className="space-y-2">
                      <div>
                        <dt className="text-xs font-medium text-gray-500">
                          Subjective
                        </dt>
                        <dd className="text-gray-800">
                          {truncateSummary(draftSubjective)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500">
                          Objective
                        </dt>
                        <dd className="text-gray-800">
                          {truncateSummary(draftObjective)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500">
                          Assessment
                        </dt>
                        <dd className="text-gray-800">
                          {truncateSummary(draftAssessment)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-gray-500">Plan</dt>
                        <dd className="text-gray-800">
                          {truncateSummary(draftPlan)}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {draftNoteStatus === "draft" ||
                  draftNoteStatus === "needs_correction" ? (
                    <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Submit this note for AI Review from the AI Review tab
                      before signing.
                    </p>
                  ) : null}

                  {draftNoteStatus === "ready_for_review" ? (
                    <div className="rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-900">
                      {/* TODO: Wire Sign Note from the editor for ready_for_review notes.
                          Signing is currently only available via the PT Review modal (reviewNote),
                          not from the editor workflow. */}
                      <p>
                        This note passed AI review and is ready for PT signature.
                        Use the Review Queue to sign.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-gray-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="text-sm font-medium text-gray-600 hover:text-gray-900"
                >
                  Cancel
                </button>
                <div className="flex flex-wrap gap-2">
                  {editorTab === 5 &&
                  draftNoteStatus !== "ai_flagged" ? (
                    <button
                      type="button"
                      disabled={editorBusy}
                      onClick={() => void submitForAiReview()}
                      className={`${DS_PRIMARY_BTN} min-h-[44px] disabled:opacity-60`}
                    >
                      {editorBusy ? "Working…" : "Submit for AI Review"}
                    </button>
                  ) : null}
                  {editorTab === 6 && canEditNote(draftNoteStatus) ? (
                    <button
                      type="button"
                      disabled={editorBusy}
                      onClick={() => void saveDraft()}
                      className={`${DS_SECONDARY_BTN} min-h-[44px] px-4 py-2.5 disabled:opacity-60`}
                    >
                      {editorBusy ? "Saving…" : "Save Draft"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
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
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setViewNote(null);
                      void openEditorForNote(viewNote);
                    }}
                    className={DS_SECONDARY_BTN}
                  >
                    Edit Note
                  </button>
                  <button
                    type="button"
                    disabled={signAnywayBusy}
                    onClick={() => void signAnyway(viewNote)}
                    className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
                  >
                    {signAnywayBusy ? "Signing…" : "Sign Anyway"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-red-700">
                  Signing anyway overrides the AI flag and will be recorded on the note for review.
                </p>
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
              {showSpecialTestsForNoteType(viewNote.note_type) ? (
                <SpecialTestsSection
                  noteId={viewNote.id}
                  clinicId={clinicId}
                  readOnly
                />
              ) : null}
              <CptDetectionPanel
                noteId={viewNote.id}
                clinicId={clinicId}
                initialCodes={(viewNote.cpt_codes_detected ?? []) as CptCode[]}
              />
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
            <div className="mt-6 flex items-center justify-between gap-4 border-t border-gray-100 pt-4">
              <p className="text-xs text-gray-500">
                Created {formatNoteDate(viewNote.created_at)}
                {viewNote.author_name ? ` · ${viewNote.author_name}` : ""}
              </p>
              {(viewNote.status ?? "").toLowerCase() === "signed" ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {viewNote.note_type?.toLowerCase().includes("evaluation") ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPocLiveSoap(null);
                        setPocNote(viewNote);
                      }}
                      className={DS_SECONDARY_BTN}
                    >
                      Plan of Care
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void exportNotePdf(viewNote)}
                    disabled={exportingNoteId === viewNote.id}
                    className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    {exportingNoteId === viewNote.id
                      ? "Exporting…"
                      : "Download PDF"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {pocNote ? (
        <PlanOfCareModal
          note={{ ...pocNote, clinic_id: clinicId }}
          clinicId={clinicId}
          patientName={pocNote.patient_name}
          subjectiveText={pocLiveSoap?.subjectiveText}
          assessmentText={pocLiveSoap?.assessmentText}
          planText={pocLiveSoap?.planText}
          onClose={() => {
            setPocNote(null);
            setPocLiveSoap(null);
          }}
        />
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

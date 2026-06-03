"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Pencil, Printer } from "lucide-react";

import {
  appointmentStatusBadgeClass,
  billingStatusBadgeClass,
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_SECTION_HEADER,
  DS_TH,
  DS_TR,
  membershipStatusBadgeClass,
  piCaseStatusBadgeClass,
} from "@/app/admin/designSystem";

import {
  injectIntakePrintStylesAndPrint,
  intakeMedicalHistoryPills,
  painDotClass,
} from "@/lib/intakePrint";
import { supabase } from "@/lib/supabase";
import { PatientGroupsSection } from "@/components/admin/PatientGroupsSection";
import { OutcomeMeasuresSection } from "@/components/admin/OutcomeMeasuresSection";
import { DmeSection } from "@/components/dme/DmeSection";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const NY = "America/New_York";
const SECONDARY_STAGGER_MS = 200;
const TAB_ACCENT = "var(--color-primary, #0D9488)";

type PageTab = "overview" | "dme" | "pi-cases";
type SectionTab = "overview" | "appointments" | "billing" | "membership";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function InlineSectionError({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
      {message}
    </p>
  );
}

type PatientRecord = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relationship?: string | null;
  insurance_carrier?: string | null;
  insurance_policy_number?: string | null;
  insurance_group_number?: string | null;
  primary_complaint?: string | null;
  referring_provider?: string | null;
  notes?: string | null;
  created_at?: string | null;
  lawyer_name?: string | null;
  law_firm?: string | null;
  lawyer_phone?: string | null;
  lawyer_email?: string | null;
};

type AppointmentListRow = {
  id: string;
  patient_id?: string;
  clinician_id: string;
  start_time: string;
  status: string;
  patients?: { first_name?: string; last_name?: string } | null;
  treatment_types?: { name?: string } | null;
};

type BillingRow = {
  date_of_service?: string;
  total_billed_cents?: number | null;
  status?: string;
};

type PiCaseRow = {
  id?: string;
  claim_number?: string | null;
  date_of_accident?: string | null;
  status?: string;
  attorney_name?: string | null;
};

type MembershipRow = {
  status?: string;
  visits_remaining?: number;
  membership_tiers?: { name?: string } | { name?: string }[] | null;
};

type IntakeFormRow = {
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
};

type SurveyResponseRow = {
  id: string;
  appointment_id?: string | null;
  q1_overall?: number | null;
  q2_pain_relief?: number | null;
  q3_provider?: number | null;
  q4_recommend?: number | null;
  avg_score?: number | null;
  completed?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const CLINICIAN_WEST_ID = "fb6fa0fc-78f3-48c0-818b-511ad7a8ee93";
const CLINICIAN_SHARPE_ID = "ee6eaa90-1f90-4af7-85a5-4ae78aea3df7";

function clinicianLabel(id: string): string {
  if (id === CLINICIAN_WEST_ID) return "Dr. West";
  if (id === CLINICIAN_SHARPE_ID) return "Dr. Sharpe";
  return id;
}

function patientDisplayName(p: PatientRecord): string {
  const s = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return s || "Patient";
}

function initials(p: PatientRecord): string {
  const a = (p.first_name ?? "").trim().charAt(0);
  const b = (p.last_name ?? "").trim().charAt(0);
  const s = `${a}${b}`.toUpperCase();
  return s || "?";
}

function formatDob(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd).trim());
  if (!m) return ymd;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

function formatAppointmentDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

function formatUsdFromCents(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
}

function avgScoreColorClass(avg: number): string {
  if (avg >= 4) return "text-green-600";
  if (avg >= 3) return "text-amber-600";
  return "text-red-600";
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

function formatSurveyDate(row: SurveyResponseRow): string {
  const raw = row.updated_at || row.created_at;
  if (!raw) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: NY,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(raw));
  } catch {
    return "—";
  }
}

function tierNameFromRow(row: MembershipRow): string {
  const t = row.membership_tiers;
  if (Array.isArray(t)) {
    const n = t[0]?.name;
    return (n ?? "").trim() || "—";
  }
  if (t && typeof t === "object" && "name" in t) {
    return String((t as { name?: string }).name ?? "").trim() || "—";
  }
  return "—";
}

const FIELD_INPUT = `mt-1 w-full ${DS_INPUT}`;

const LABEL_CLASS = "block text-xs font-medium uppercase tracking-wide text-gray-500";

const SKELETON_PULSE = "animate-pulse rounded-md bg-gray-200/80";

function PatientHeaderSkeleton() {
  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-6 px-6 py-6 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className={`h-16 w-16 shrink-0 ${SKELETON_PULSE}`} />
          <div className="min-w-0 flex-1 space-y-3 py-1">
            <div className={`h-8 w-48 max-w-full ${SKELETON_PULSE}`} />
            <div className={`h-4 w-full max-w-md ${SKELETON_PULSE}`} />
          </div>
        </div>
        <div className={`h-10 w-28 shrink-0 ${SKELETON_PULSE}`} />
      </div>
    </div>
  );
}

function TableSkeleton({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className={DS_TR}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-6 py-4">
              <div className={`h-4 w-[85%] ${SKELETON_PULSE}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-4 w-full ${SKELETON_PULSE}`} />
      ))}
    </div>
  );
}

function PatientIntakeHistoryCard({
  intake,
  patientDisplay,
  expanded,
  onToggle,
  printDomId,
}: {
  intake: IntakeFormRow;
  patientDisplay: string;
  expanded: boolean;
  onToggle: () => void;
  printDomId: string;
}) {
  const submittedLabel = formatIntakeSubmittedDate(intake.created_at);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-stretch gap-2 border-b border-gray-100">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <span className="shrink-0 text-gray-400" aria-hidden>
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Submitted {submittedLabel}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm font-medium text-gray-900">
              {chiefComplaintSummary(intake.chief_complaint)}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center border-l border-gray-100 pr-3 pl-1">
          <button
            type="button"
            className="intake-print-toolbar-btn inline-flex items-center gap-1.5 rounded-md border border-[#16A34A] px-2.5 py-1 text-xs font-medium text-[#16A34A] hover:bg-green-50"
            title="Download PDF"
            aria-label="Download PDF"
            onClick={(e) => {
              e.stopPropagation();
              injectIntakePrintStylesAndPrint(printDomId);
            }}
          >
            <Printer className="size-3.5 shrink-0" aria-hidden />
            Download PDF
          </button>
        </div>
      </div>

      <div
        id={printDomId}
        className={
          expanded
            ? ""
            : "max-h-0 overflow-hidden"
        }
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
                  const pills = intakeMedicalHistoryPills(
                    intake.medical_history_flags,
                  );
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
    </div>
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export type PatientDetailViewProps = {
  patientId: string;
  clinicId: string;
  embedded?: boolean;
  onBack?: () => void;
};

export function PatientDetailView({
  patientId,
  clinicId,
  embedded = false,
  onBack,
}: PatientDetailViewProps) {
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [draft, setDraft] = useState<PatientRecord | null>(null);
  const [appointments, setAppointments] = useState<AppointmentListRow[]>([]);
  const [billingRows, setBillingRows] = useState<BillingRow[]>([]);
  const [membershipRows, setMembershipRows] = useState<MembershipRow[]>([]);
  const [piRows, setPiRows] = useState<PiCaseRow[]>([]);
  const [surveyRows, setSurveyRows] = useState<SurveyResponseRow[]>([]);
  const [intakeForms, setIntakeForms] = useState<IntakeFormRow[]>([]);
  const [intakesLoading, setIntakesLoading] = useState(false);
  const [intakesFetchError, setIntakesFetchError] = useState<string | null>(null);
  const [expandedIntakeIds, setExpandedIntakeIds] = useState<Set<string>>(() => new Set());

  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [piLoading, setPiLoading] = useState(false);
  const [piError, setPiError] = useState<string | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [surveysLoading, setSurveysLoading] = useState(false);
  const [surveysError, setSurveysError] = useState<string | null>(null);

  const [loadingPatient, setLoadingPatient] = useState(true);
  const [patientReady, setPatientReady] = useState(false);
  const [patientLoadError, setPatientLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [pageTab, setPageTab] = useState<PageTab>("overview");
  const [sectionTab, setSectionTab] = useState<SectionTab>("overview");
  const [piCasesEverOpened, setPiCasesEverOpened] = useState(false);

  const [legalEdit, setLegalEdit] = useState(false);
  const [legalDraft, setLegalDraft] = useState({
    lawyer_name: "",
    law_firm: "",
    lawyer_phone: "",
    lawyer_email: "",
  });
  const [legalSaveBusy, setLegalSaveBusy] = useState(false);

  const loadSecondaryResources = useCallback(
    async (isCancelled: () => boolean) => {
      if (!patientId || !clinicId) return;

      setAppointments([]);
      setBillingRows([]);
      setMembershipRows([]);
      setSurveyRows([]);
      setIntakeForms([]);
      setExpandedIntakeIds(new Set());
      setAppointmentsError(null);
      setBillingError(null);
      setMembershipError(null);
      setSurveysError(null);
      setIntakesFetchError(null);

      const h = await authHeaders();

      setAppointmentsLoading(true);
      try {
        const apRes = await fetch(
          `${API_BASE}/appointments?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        if (isCancelled()) return;
        if (!apRes.ok) {
          setAppointmentsError(
            (await apRes.text().catch(() => "")).trim() ||
              `Could not load appointments (${apRes.status})`,
          );
          setAppointments([]);
        } else {
          const apJson = await apRes.json();
          const allAp = Array.isArray(apJson) ? apJson : [];
          setAppointments(
            allAp.filter(
              (a: AppointmentListRow) => a.patient_id === patientId,
            ) as AppointmentListRow[],
          );
        }
      } catch {
        if (!isCancelled()) {
          setAppointmentsError("Could not load appointments.");
          setAppointments([]);
        }
      } finally {
        if (!isCancelled()) setAppointmentsLoading(false);
      }

      await sleep(SECONDARY_STAGGER_MS);
      if (isCancelled()) return;

      setBillingLoading(true);
      try {
        const brRes = await fetch(
          `${API_BASE}/billing-records?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(patientId)}`,
          { headers: h },
        );
        if (isCancelled()) return;
        if (!brRes.ok) {
          setBillingError(
            (await brRes.text().catch(() => "")).trim() ||
              `Could not load billing (${brRes.status})`,
          );
          setBillingRows([]);
        } else {
          const brJson = await brRes.json();
          setBillingRows(Array.isArray(brJson) ? brJson : []);
        }
      } catch {
        if (!isCancelled()) {
          setBillingError("Could not load billing records.");
          setBillingRows([]);
        }
      } finally {
        if (!isCancelled()) setBillingLoading(false);
      }

      await sleep(SECONDARY_STAGGER_MS);
      if (isCancelled()) return;

      setMembershipLoading(true);
      try {
        const memRes = await fetch(
          `${API_BASE}/patient-memberships?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(patientId)}`,
          { headers: h },
        );
        if (isCancelled()) return;
        if (!memRes.ok) {
          setMembershipError(
            (await memRes.text().catch(() => "")).trim() ||
              `Could not load memberships (${memRes.status})`,
          );
          setMembershipRows([]);
        } else {
          const memJson = await memRes.json();
          setMembershipRows(Array.isArray(memJson) ? memJson : []);
        }
      } catch {
        if (!isCancelled()) {
          setMembershipError("Could not load memberships.");
          setMembershipRows([]);
        }
      } finally {
        if (!isCancelled()) setMembershipLoading(false);
      }

      await sleep(SECONDARY_STAGGER_MS);
      if (isCancelled()) return;

      setSurveysLoading(true);
      try {
        const surveyRes = await fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/surveys?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        if (isCancelled()) return;
        if (!surveyRes.ok) {
          setSurveysError(
            (await surveyRes.text().catch(() => "")).trim() ||
              `Could not load surveys (${surveyRes.status})`,
          );
          setSurveyRows([]);
        } else {
          const surveyJson = await surveyRes.json();
          setSurveyRows(Array.isArray(surveyJson) ? surveyJson : []);
        }
      } catch {
        if (!isCancelled()) {
          setSurveysError("Could not load surveys.");
          setSurveyRows([]);
        }
      } finally {
        if (!isCancelled()) setSurveysLoading(false);
      }

      await sleep(SECONDARY_STAGGER_MS);
      if (isCancelled()) return;

      setIntakesLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/intake/patient/${encodeURIComponent(patientId)}`,
          { headers: h },
        );
        if (isCancelled()) return;
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          setIntakesFetchError(
            res.status === 401 || res.status === 403
              ? "Sign in required to load intake history."
              : t.trim() || `Could not load intakes (${res.status})`,
          );
          setIntakeForms([]);
          return;
        }
        const json = (await res.json()) as { intakes?: unknown };
        const list = Array.isArray(json.intakes)
          ? (json.intakes as IntakeFormRow[])
          : [];
        setIntakeForms(list);
        if (list.length > 0) {
          const firstPid = String(list[0].id ?? "").trim();
          const firstKey = firstPid || "row-0";
          setExpandedIntakeIds(new Set([firstKey]));
        }
      } catch {
        if (!isCancelled()) {
          setIntakesFetchError("Could not load intake history.");
          setIntakeForms([]);
        }
      } finally {
        if (!isCancelled()) setIntakesLoading(false);
      }
    },
    [patientId, clinicId],
  );

  const loadPiCases = useCallback(async () => {
    if (!patientId || !clinicId) return;
    setPiLoading(true);
    setPiError(null);
    try {
      const h = await authHeaders();
      const piRes = await fetch(
        `${API_BASE}/pi-cases?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(patientId)}`,
        { headers: h },
      );
      if (!piRes.ok) {
        setPiError(
          (await piRes.text().catch(() => "")).trim() ||
            `Could not load PI cases (${piRes.status})`,
        );
        setPiRows([]);
        return;
      }
      const piJson = await piRes.json();
      setPiRows(Array.isArray(piJson) ? piJson : []);
    } catch {
      setPiError("Could not load PI cases.");
      setPiRows([]);
    } finally {
      setPiLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    if (!patientId || !clinicId) return;
    let cancelled = false;
    setPatientReady(false);
    setLoadingPatient(true);
    setPatientLoadError(null);
    setPatient(null);
    setDraft(null);
    setPageTab("overview");
    setSectionTab("overview");
    setPiCasesEverOpened(false);
    setPiRows([]);
    setPiError(null);
    setAppointments([]);
    setBillingRows([]);
    setMembershipRows([]);
    setSurveyRows([]);

    void (async () => {
      try {
        const h = await authHeaders();
        const ptRes = await fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        if (cancelled) return;
        if (!ptRes.ok) {
          setPatient(null);
          setDraft(null);
          setPatientLoadError(
            ptRes.status === 404 ? "Patient not found." : `Error ${ptRes.status}`,
          );
          return;
        }
        const ptJson = (await ptRes.json()) as PatientRecord;
        setPatient(ptJson);
        setDraft({ ...ptJson });
        setLegalDraft({
          lawyer_name: ptJson.lawyer_name ?? "",
          law_firm: ptJson.law_firm ?? "",
          lawyer_phone: ptJson.lawyer_phone ?? "",
          lawyer_email: ptJson.lawyer_email ?? "",
        });
        setLegalEdit(false);
        setPatientReady(true);
      } catch {
        if (!cancelled) {
          setPatientLoadError("Could not load patient.");
          setPatient(null);
          setDraft(null);
        }
      } finally {
        if (!cancelled) setLoadingPatient(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, clinicId]);

  useEffect(() => {
    if (!patientReady || !patientId || !clinicId) return;
    let cancelled = false;
    void loadSecondaryResources(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [patientReady, patientId, clinicId, loadSecondaryResources]);

  useEffect(() => {
    if (pageTab !== "pi-cases" || !patientReady || piCasesEverOpened) return;
    setPiCasesEverOpened(true);
    void loadPiCases();
  }, [pageTab, patientReady, piCasesEverOpened, loadPiCases]);

  function toggleIntakeExpanded(id: string) {
    setExpandedIntakeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const activeMembership = useMemo(() => {
    const active = membershipRows.find(
      (m) => (m.status ?? "").toLowerCase() === "active",
    );
    return active ?? null;
  }, [membershipRows]);

  const appointmentTableRows = useMemo(() => {
    return [...appointments].sort(
      (a, b) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime(),
    );
  }, [appointments]);

  const completedSurveys = useMemo(
    () =>
      surveyRows.filter(
        (s) => s.completed === true || String(s.completed).toLowerCase() === "true",
      ),
    [surveyRows],
  );

  const loadingMembershipTabData = membershipLoading || surveysLoading;

  const pageTabs: { id: PageTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "dme", label: "DME" },
    { id: "pi-cases", label: "PI Cases" },
  ];

  function setDraftField<K extends keyof PatientRecord>(
    key: K,
    value: PatientRecord[K],
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function beginEdit() {
    if (patient) setDraft({ ...patient });
    setEditMode(true);
  }

  function cancelEdit() {
    if (patient) setDraft({ ...patient });
    setEditMode(false);
  }

  async function saveEdit() {
    if (!patientId || !draft) return;
    setSaveBusy(true);
    setActionError(null);
    try {
      const body: Record<string, unknown> = {};
      const keys = [
        "first_name",
        "last_name",
        "email",
        "phone",
        "date_of_birth",
        "gender",
        "address_line1",
        "address_line2",
        "city",
        "state",
        "zip",
        "emergency_contact_name",
        "emergency_contact_phone",
        "emergency_contact_relationship",
        "insurance_carrier",
        "insurance_policy_number",
        "insurance_group_number",
        "primary_complaint",
        "referring_provider",
        "notes",
      ] as const;
      for (const k of keys) {
        body[k] = draft[k] ?? null;
      }
      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setActionError(await res.text().catch(() => "Save failed"));
        return;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const patientFields = { ...data };
      delete patientFields.appointments;
      delete patientFields.billing_records;
      delete patientFields.memberships;
      delete patientFields.pi_cases;
      setPatient(patientFields as PatientRecord);
      setDraft({ ...(patientFields as PatientRecord) });
      void loadSecondaryResources(() => false);
      setEditMode(false);
    } catch {
      setActionError("Save failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function saveLegal() {
    if (!patientId) return;
    setLegalSaveBusy(true);
    setActionError(null);
    try {
      const body = {
        lawyer_name: legalDraft.lawyer_name.trim() || null,
        law_firm: legalDraft.law_firm.trim() || null,
        lawyer_phone: legalDraft.lawyer_phone.trim() || null,
        lawyer_email: legalDraft.lawyer_email.trim() || null,
      };
      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setActionError(await res.text().catch(() => "Save failed"));
        return;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const patientFields = { ...data };
      delete patientFields.appointments;
      delete patientFields.billing_records;
      delete patientFields.memberships;
      delete patientFields.pi_cases;
      setPatient(patientFields as PatientRecord);
      setDraft((d) => (d ? { ...d, ...(patientFields as PatientRecord) } : d));
      setLegalDraft({
        lawyer_name: String(patientFields.lawyer_name ?? ""),
        law_firm: String(patientFields.law_firm ?? ""),
        lawyer_phone: String(patientFields.lawyer_phone ?? ""),
        lawyer_email: String(patientFields.lawyer_email ?? ""),
      });
      void loadSecondaryResources(() => false);
      setLegalEdit(false);
    } catch {
      setActionError("Save failed.");
    } finally {
      setLegalSaveBusy(false);
    }
  }

  function cancelLegal() {
    if (patient) {
      setLegalDraft({
        lawyer_name: patient.lawyer_name ?? "",
        law_firm: patient.law_firm ?? "",
        lawyer_phone: patient.lawyer_phone ?? "",
        lawyer_email: patient.lawyer_email ?? "",
      });
    }
    setLegalEdit(false);
  }

  const hasLawyerInfo = Boolean(
    (patient?.lawyer_name ?? "").trim() ||
      (patient?.law_firm ?? "").trim() ||
      (patient?.lawyer_phone ?? "").trim() ||
      (patient?.lawyer_email ?? "").trim(),
  );

  if (!patientId) {
    return (
      <div className="text-sm text-gray-600">Invalid patient id.</div>
    );
  }

  const rootClass = embedded
    ? "flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#f8fafc] px-4 pb-8 pt-4"
    : DS_PAGE_ROOT;

  if (loadingPatient && !patient) {
    return (
      <div className={rootClass}>
        {onBack ? (
          <div className="mb-4">
            <button
              type="button"
              onClick={onBack}
              className={`text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 ${embedded ? "md:hidden" : ""}`}
            >
              {embedded ? "← Back" : "← Patients"}
            </button>
          </div>
        ) : null}
        <PatientHeaderSkeleton />
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className={`rounded-2xl border border-gray-100 bg-white p-6 shadow-sm`}>
            <CardSkeleton lines={8} />
          </div>
          <div className={`rounded-2xl border border-gray-100 bg-white p-6 shadow-sm`}>
            <CardSkeleton lines={8} />
          </div>
        </div>
      </div>
    );
  }

  if (patientLoadError && !patient) {
    return (
      <div className="space-y-4">
        <p className="rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {patientLoadError}
        </p>
        <Link
          href="/admin/patients"
          className="text-sm font-medium text-[#16A34A] hover:underline"
        >
          ← Back to patients
        </Link>
      </div>
    );
  }

  if (!patient || !draft) {
    return null;
  }

  const display = editMode ? draft : patient;

  const sectionTabs: { id: SectionTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "appointments", label: "Appointments" },
    { id: "billing", label: "Billing" },
    { id: "membership", label: "Memberships" },
  ];

  return (
    <div className={rootClass}>
      {onBack ? (
        <div className="mb-4">
          <button
            type="button"
            onClick={onBack}
            className={`text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 ${embedded ? "md:hidden" : ""}`}
          >
            {embedded ? "← Back" : "← Patients"}
          </button>
        </div>
      ) : null}

      <div className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-col gap-6 px-6 py-6 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-green-50 text-lg font-medium text-green-700">
              {initials(patient)}
            </div>
            <div className="min-w-0">
              <h1 className={DS_PAGE_TITLE}>
                {patientDisplayName(patient)}
              </h1>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500">
                <span>{display.phone?.trim() || "—"}</span>
                <span className="text-gray-300">|</span>
                <span>{display.email?.trim() || "—"}</span>
                <span className="text-gray-300">|</span>
                <span>DOB {formatDob(display.date_of_birth ?? undefined)}</span>
                <span className="text-gray-300">|</span>
                <span>{display.gender?.trim() || "—"}</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {editMode ? (
              <>
                <button
                  type="button"
                  disabled={saveBusy}
                  onClick={() => void saveEdit()}
                  className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
                >
                  {saveBusy ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={saveBusy}
                  onClick={cancelEdit}
                  className={DS_SECONDARY_BTN}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={beginEdit}
                className={DS_PRIMARY_BTN}
              >
                Edit Profile
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-1 mb-6 border-b border-gray-200 bg-[#f8fafc]/95 px-1 pb-0 backdrop-blur-sm">
        <div className="flex gap-1" role="tablist" aria-label="Patient sections">
          {pageTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={pageTab === t.id}
              onClick={() => setPageTab(t.id)}
              className={[
                "rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors",
                pageTab === t.id
                  ? "border-b-2 text-[var(--color-primary,#0D9488)]"
                  : "border-b-2 border-transparent text-gray-500 hover:text-gray-800",
              ].join(" ")}
              style={
                pageTab === t.id
                  ? { borderBottomColor: TAB_ACCENT, color: TAB_ACCENT }
                  : undefined
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {pageTab === "overview" ? (
        <>
      <div className="relative mb-6 rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
            Legal / PI Information
          </h2>
          {!legalEdit ? (
            <button
              type="button"
              onClick={() => {
                setLegalDraft({
                  lawyer_name: patient.lawyer_name ?? "",
                  law_firm: patient.law_firm ?? "",
                  lawyer_phone: patient.lawyer_phone ?? "",
                  lawyer_email: patient.lawyer_email ?? "",
                });
                setLegalEdit(true);
              }}
              className="rounded p-1 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
              aria-label="Edit legal information"
            >
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {legalEdit ? (
          <div className="space-y-4">
            <div>
              <span className={LABEL_CLASS}>Lawyer Name</span>
              <input
                className={FIELD_INPUT}
                value={legalDraft.lawyer_name}
                onChange={(e) =>
                  setLegalDraft((d) => ({ ...d, lawyer_name: e.target.value }))
                }
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Law Firm</span>
              <input
                className={FIELD_INPUT}
                value={legalDraft.law_firm}
                onChange={(e) =>
                  setLegalDraft((d) => ({ ...d, law_firm: e.target.value }))
                }
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Lawyer Phone</span>
              <input
                className={FIELD_INPUT}
                value={legalDraft.lawyer_phone}
                onChange={(e) =>
                  setLegalDraft((d) => ({ ...d, lawyer_phone: e.target.value }))
                }
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Lawyer Email</span>
              <input
                type="email"
                className={FIELD_INPUT}
                value={legalDraft.lawyer_email}
                onChange={(e) =>
                  setLegalDraft((d) => ({ ...d, lawyer_email: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={legalSaveBusy}
                onClick={() => void saveLegal()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
              >
                {legalSaveBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={legalSaveBusy}
                onClick={cancelLegal}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : hasLawyerInfo ? (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className={LABEL_CLASS}>Lawyer Name</dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {(patient.lawyer_name ?? "").trim() || "—"}
              </dd>
            </div>
            <div>
              <dt className={LABEL_CLASS}>Law Firm</dt>
              <dd className="mt-1 text-gray-800">
                {(patient.law_firm ?? "").trim() || "—"}
              </dd>
            </div>
            <div>
              <dt className={LABEL_CLASS}>Lawyer Phone</dt>
              <dd className="mt-1 text-gray-800">
                {(patient.lawyer_phone ?? "").trim() || "—"}
              </dd>
            </div>
            <div>
              <dt className={LABEL_CLASS}>Lawyer Email</dt>
              <dd className="mt-1 text-gray-800">
                {(patient.lawyer_email ?? "").trim() || "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <button
            type="button"
            onClick={() => {
              setLegalDraft({
                lawyer_name: "",
                law_firm: "",
                lawyer_phone: "",
                lawyer_email: "",
              });
              setLegalEdit(true);
            }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Assign lawyer
          </button>
        )}
      </div>

      {actionError ? (
        <p className="mb-4 rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {actionError}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-100 pb-1">
        {sectionTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSectionTab(t.id)}
            className={[
              "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
              sectionTab === t.id
                ? "border-b-2 border-[#16A34A] text-[#16A34A]"
                : "text-gray-500 hover:text-gray-800",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sectionTab === "overview" ? (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Address</h2>
            <div className="space-y-4">
              <div>
                <span className={LABEL_CLASS}>Line 1</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.address_line1 ?? ""}
                    onChange={(e) =>
                      setDraftField("address_line1", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.address_line1?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Line 2</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.address_line2 ?? ""}
                    onChange={(e) =>
                      setDraftField("address_line2", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.address_line2?.trim() || "—"}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={LABEL_CLASS}>City</span>
                  {editMode ? (
                    <input
                      className={FIELD_INPUT}
                      value={draft.city ?? ""}
                      onChange={(e) => setDraftField("city", e.target.value)}
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-800">
                      {display.city?.trim() || "—"}
                    </p>
                  )}
                </div>
                <div>
                  <span className={LABEL_CLASS}>State</span>
                  {editMode ? (
                    <input
                      className={FIELD_INPUT}
                      value={draft.state ?? ""}
                      onChange={(e) => setDraftField("state", e.target.value)}
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-800">
                      {display.state?.trim() || "—"}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <span className={LABEL_CLASS}>ZIP</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.zip ?? ""}
                    onChange={(e) => setDraftField("zip", e.target.value)}
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.zip?.trim() || "—"}
                  </p>
                )}
              </div>
            </div>
            <h2 className={`${DS_SECTION_HEADER} mt-8`}>
              Emergency contact
            </h2>
            <div className="space-y-4">
              <div>
                <span className={LABEL_CLASS}>Name</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.emergency_contact_name ?? ""}
                    onChange={(e) =>
                      setDraftField("emergency_contact_name", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.emergency_contact_name?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Phone</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.emergency_contact_phone ?? ""}
                    onChange={(e) =>
                      setDraftField("emergency_contact_phone", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.emergency_contact_phone?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Relationship</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.emergency_contact_relationship ?? ""}
                    onChange={(e) =>
                      setDraftField(
                        "emergency_contact_relationship",
                        e.target.value,
                      )
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.emergency_contact_relationship?.trim() || "—"}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className={DS_CARD}>
            <h2 className={DS_SECTION_HEADER}>Insurance</h2>
            <div className="space-y-4">
              <div>
                <span className={LABEL_CLASS}>Carrier</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.insurance_carrier ?? ""}
                    onChange={(e) =>
                      setDraftField("insurance_carrier", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.insurance_carrier?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Policy number</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.insurance_policy_number ?? ""}
                    onChange={(e) =>
                      setDraftField("insurance_policy_number", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.insurance_policy_number?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Group number</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.insurance_group_number ?? ""}
                    onChange={(e) =>
                      setDraftField("insurance_group_number", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.insurance_group_number?.trim() || "—"}
                  </p>
                )}
              </div>
            </div>
            <h2 className="mb-4 mt-8 text-sm font-semibold text-gray-900">Clinical</h2>
            <div className="space-y-4">
              <div>
                <span className={LABEL_CLASS}>Primary complaint</span>
                {editMode ? (
                  <textarea
                    className={`${FIELD_INPUT} min-h-[72px]`}
                    value={draft.primary_complaint ?? ""}
                    onChange={(e) =>
                      setDraftField("primary_complaint", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                    {display.primary_complaint?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Referring provider</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.referring_provider ?? ""}
                    onChange={(e) =>
                      setDraftField("referring_provider", e.target.value)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.referring_provider?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Notes</span>
                {editMode ? (
                  <textarea
                    className={`${FIELD_INPUT} min-h-[96px]`}
                    value={draft.notes ?? ""}
                    onChange={(e) => setDraftField("notes", e.target.value)}
                  />
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                    {display.notes?.trim() || "—"}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className={`md:col-span-2 ${DS_CARD}`}>
            <h2 className={DS_SECTION_HEADER}>Profile</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <span className={LABEL_CLASS}>First name</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.first_name ?? ""}
                    onChange={(e) => setDraftField("first_name", e.target.value)}
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.first_name ?? "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Last name</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.last_name ?? ""}
                    onChange={(e) => setDraftField("last_name", e.target.value)}
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.last_name ?? "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Phone</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.phone ?? ""}
                    onChange={(e) => setDraftField("phone", e.target.value)}
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.phone?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Email</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    type="email"
                    value={draft.email ?? ""}
                    onChange={(e) => setDraftField("email", e.target.value)}
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.email?.trim() || "—"}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Date of birth</span>
                {editMode ? (
                  <input
                    type="date"
                    className={FIELD_INPUT}
                    value={(draft.date_of_birth ?? "").slice(0, 10)}
                    onChange={(e) =>
                      setDraftField("date_of_birth", e.target.value || null)
                    }
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {formatDob(display.date_of_birth ?? undefined)}
                  </p>
                )}
              </div>
              <div>
                <span className={LABEL_CLASS}>Gender</span>
                {editMode ? (
                  <input
                    className={FIELD_INPUT}
                    value={draft.gender ?? ""}
                    onChange={(e) => setDraftField("gender", e.target.value)}
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-800">
                    {display.gender?.trim() || "—"}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className={`md:col-span-2 ${DS_CARD}`}>
            <h2 className={DS_SECTION_HEADER}>Intake History</h2>
            {intakesLoading ? (
              <div className="mt-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={`h-16 w-full ${SKELETON_PULSE}`} />
                ))}
              </div>
            ) : intakesFetchError ? (
              <p className="mt-4 text-sm text-amber-800">{intakesFetchError}</p>
            ) : intakeForms.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No intake forms on file yet
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {intakeForms.map((row, idx) => {
                  const pid = String(row.id ?? "").trim();
                  const fallbackKey = `row-${idx}`;
                  const toggleKey = pid || fallbackKey;
                  const domId = `intake-print-${toggleKey}`;
                  return (
                    <PatientIntakeHistoryCard
                      key={toggleKey}
                      intake={row}
                      patientDisplay={patientDisplayName(patient)}
                      expanded={expandedIntakeIds.has(toggleKey)}
                      printDomId={domId}
                      onToggle={() => {
                        toggleIntakeExpanded(toggleKey);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {sectionTab === "appointments" ? (
        <div className={`${DS_TABLE_WRAP} mt-8`}>
          {appointmentsError ? (
            <div className="border-b border-gray-100 px-6 py-4">
              <InlineSectionError message={appointmentsError} />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Date</th>
                  <th className={DS_TH}>Clinician</th>
                  <th className={DS_TH}>Service</th>
                  <th className={DS_TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {appointmentsLoading ? (
                  <TableSkeleton cols={4} rows={5} />
                ) : appointmentTableRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-10 text-center text-gray-500"
                    >
                      No appointments for this patient.
                    </td>
                  </tr>
                ) : (
                  appointmentTableRows.map((row) => {
                    return (
                      <tr key={row.id} className={DS_TR}>
                        <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                          {formatAppointmentDate(row.start_time)}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          {clinicianLabel(row.clinician_id)}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          {row.treatment_types?.name ?? "—"}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          <span
                            className={appointmentStatusBadgeClass(
                              row.status ?? "",
                            )}
                          >
                            {row.status ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {sectionTab === "billing" ? (
        <div className={`${DS_TABLE_WRAP} mt-8`}>
          {billingError ? (
            <div className="border-b border-gray-100 px-6 py-4">
              <InlineSectionError message={billingError} />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Date</th>
                  <th className={DS_TH}>Total billed</th>
                  <th className={DS_TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {billingLoading ? (
                  <TableSkeleton cols={3} rows={4} />
                ) : billingRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-6 py-10 text-center text-gray-500"
                    >
                      No billing records for this patient.
                    </td>
                  </tr>
                ) : (
                  billingRows.map((row, idx) => {
                    const id = `${row.date_of_service}-${idx}`;
                    const st = (row.status ?? "").toLowerCase();
                    return (
                      <tr key={id} className={DS_TR}>
                        <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                          {row.date_of_service
                            ? formatDob(String(row.date_of_service))
                            : "—"}
                        </td>
                        <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                          {formatUsdFromCents(row.total_billed_cents)}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          <span className={billingStatusBadgeClass(st)}>
                            {row.status ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {sectionTab === "membership" ? (
        <div className="mt-8 space-y-8">
          {membershipError ? (
            <InlineSectionError message={membershipError} />
          ) : null}
          <div className={DS_CARD}>
            <h2 className={DS_SECTION_HEADER}>Active membership</h2>
            {loadingMembershipTabData ? (
              <CardSkeleton lines={4} />
            ) : !activeMembership ? (
              <p className="text-sm text-gray-500">No active enrollment.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <span className={LABEL_CLASS}>Tier</span>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {tierNameFromRow(activeMembership)}
                  </p>
                </div>
                <div>
                  <span className={LABEL_CLASS}>Visits remaining</span>
                  <p className="mt-1 text-sm text-gray-800">
                    {activeMembership.visits_remaining ?? 0}
                  </p>
                </div>
                <div>
                  <span className={LABEL_CLASS}>Status</span>
                  <p className="mt-1">
                    <span
                      className={membershipStatusBadgeClass(
                        activeMembership.status ?? "",
                      )}
                    >
                      {activeMembership.status ?? "—"}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-8">
            <h2 className={DS_SECTION_HEADER}>Surveys</h2>
            {surveysError ? (
              <div className="mt-2">
                <InlineSectionError message={surveysError} />
              </div>
            ) : null}
            {surveysLoading ? (
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                <div className={`${DS_CARD} min-h-[180px]`}>
                  <CardSkeleton lines={6} />
                </div>
                <div className={`${DS_CARD} min-h-[180px]`}>
                  <CardSkeleton lines={6} />
                </div>
              </div>
            ) : completedSurveys.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">
                No survey responses yet.
              </p>
            ) : (
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                {completedSurveys.map((s) => {
                  const avg = Number(s.avg_score);
                  const avgOk = Number.isFinite(avg);
                  return (
                    <div key={s.id} className={DS_CARD}>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Date
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatSurveyDate(s)}
                      </p>
                      <dl className="mt-4 space-y-2 text-sm">
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Overall</dt>
                          <dd className="font-medium text-gray-900">
                            {s.q1_overall ?? "—"}/5
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Pain relief</dt>
                          <dd className="font-medium text-gray-900">
                            {s.q2_pain_relief ?? "—"}/5
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Provider</dt>
                          <dd className="font-medium text-gray-900">
                            {s.q3_provider ?? "—"}/5
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-gray-500">Recommend</dt>
                          <dd className="font-medium text-gray-900">
                            {s.q4_recommend ?? "—"}/5
                          </dd>
                        </div>
                        <div className="flex justify-between gap-4 border-t border-gray-100 pt-3">
                          <dt className="text-gray-700">Avg score</dt>
                          <dd
                            className={`font-semibold tabular-nums ${avgOk ? avgScoreColorClass(avg) : "text-gray-900"}`}
                          >
                            {avgOk ? `${avg.toFixed(1)}/5` : "—"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <OutcomeMeasuresSection
        clinicId={clinicId}
        patientId={patientId}
        loadDelayMs={SECONDARY_STAGGER_MS}
      />
      <PatientGroupsSection
        clinicId={clinicId}
        patientId={patientId}
        loadDelayMs={SECONDARY_STAGGER_MS * 2}
      />
        </>
      ) : null}

      {pageTab === "dme" ? (
        <DmeSection clinicId={clinicId} patientId={patientId} />
      ) : null}

      {pageTab === "pi-cases" ? (
        <div className={DS_TABLE_WRAP}>
          <div className="border-b border-gray-100 bg-gray-50 px-6 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
              PI cases
            </h2>
          </div>
          {piError ? (
            <div className="px-6 py-4">
              <InlineSectionError message={piError} />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Case #</th>
                  <th className={DS_TH}>Date of accident</th>
                  <th className={DS_TH}>Attorney</th>
                  <th className={DS_TH}>Status</th>
                </tr>
              </thead>
              <tbody>
                {piLoading ? (
                  <TableSkeleton cols={4} rows={4} />
                ) : piRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-10 text-center text-gray-500"
                    >
                      No PI cases for this patient.
                    </td>
                  </tr>
                ) : (
                  piRows.map((row) => {
                    const st = (row.status ?? "").toLowerCase();
                    const caseNum = (row.claim_number ?? "").trim() || "—";
                    return (
                      <tr
                        key={row.id ?? `${caseNum}-${row.date_of_accident}`}
                        className={DS_TR}
                      >
                        <td className={`${DS_TD_PRIMARY} font-medium`}>
                          {caseNum}
                        </td>
                        <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                          {row.date_of_accident
                            ? formatDob(String(row.date_of_accident))
                            : "—"}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          {(row.attorney_name ?? "").trim() || "—"}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          <span className={piCaseStatusBadgeClass(st)}>
                            {row.status ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

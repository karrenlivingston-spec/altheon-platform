"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";

import {
  appointmentStatusBadgeClass,
  billingStatusBadgeClass,
  DS_CARD,
  DS_INPUT,
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

import { supabase } from "@/lib/supabase";
import { PatientGroupsSection } from "@/components/admin/PatientGroupsSection";
import { InsuranceBenefitsLedger } from "@/components/admin/InsuranceBenefitsLedger";
import { PatientVisitTimeline } from "@/components/admin/PatientVisitTimeline";
import { OutcomeMeasuresSection } from "@/components/admin/OutcomeMeasuresSection";
import { DmeSection } from "@/components/dme/DmeSection";
import { DiagnosticRedFlagBanner } from "@/components/admin/DiagnosticRedFlagBanner";
import { DiagnosticsTab } from "@/components/admin/DiagnosticsTab";
import { PatientDocumentsTab } from "@/components/admin/PatientDocumentsTab";
import { PatientPerformanceTab } from "@/components/admin/performance/PatientPerformanceTab";
import PatientHeader from "@/components/admin/patients/PatientHeader";
import PatientQuickStats from "@/components/admin/patients/PatientQuickStats";
import PatientOverviewTab from "@/components/admin/patients/PatientOverviewTab";
import PatientHEPTab from "@/components/admin/patients/PatientHEPTab";
import type { PatientHeaderStats } from "@/components/admin/patients/patientTypes";
import { REFERRAL_SOURCE_OPTIONS } from "@/components/admin/patients/patientTypes";
import BillingRecordDetailModal from "@/components/admin/billing/BillingRecordDetailModal";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const NY = "America/New_York";
const SECONDARY_STAGGER_MS = 200;
const TAB_ACCENT = "var(--color-primary, #0D9488)";

export type PageTab =
  | "overview"
  | "appointments"
  | "clinical"
  | "billing"
  | "documents"
  | "performance"
  | "notes"
  | "legal"
  | "memberships"
  | "packages"
  | "hep"
  | "benefits";

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
  sport?: string | null;
  referral_source?: string | null;
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
  id?: string;
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

type PackageRow = {
  id: string;
  package_name?: string | null;
  total_visits?: number | null;
  visits_used?: number | null;
  price_cents?: number | null;
  purchase_date?: string | null;
  status?: string | null;
  notes?: string | null;
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

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultPackageDraft() {
  return {
    package_name: "",
    total_visits: "",
    visits_already_used: "0",
    price_dollars: "",
    purchase_date: todayYmdLocal(),
    notes: "",
  };
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

async function authHeaders(): Promise<Record<string, string>> {
  const readToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  };
  let token = await readToken();
  if (!token) {
    await sleep(150);
    token = await readToken();
  }
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export type PatientDetailViewProps = {
  patientId: string;
  clinicId: string;
  embedded?: boolean;
  initialTab?: PageTab;
  readOnly?: boolean;
  onBack?: () => void;
};

export function PatientDetailView({
  patientId,
  clinicId,
  embedded = false,
  initialTab,
  readOnly = false,
  onBack,
}: PatientDetailViewProps) {
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [draft, setDraft] = useState<PatientRecord | null>(null);
  const [appointments, setAppointments] = useState<AppointmentListRow[]>([]);
  const [billingRows, setBillingRows] = useState<BillingRow[]>([]);
  const [membershipRows, setMembershipRows] = useState<MembershipRow[]>([]);
  const [piRows, setPiRows] = useState<PiCaseRow[]>([]);
  const [surveyRows, setSurveyRows] = useState<SurveyResponseRow[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingDetailRecordId, setBillingDetailRecordId] = useState<
    string | null
  >(null);
  const [piLoading, setPiLoading] = useState(false);
  const [piError, setPiError] = useState<string | null>(null);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [surveysLoading, setSurveysLoading] = useState(false);
  const [surveysError, setSurveysError] = useState<string | null>(null);
  const [packageRows, setPackageRows] = useState<PackageRow[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [packageFormBusy, setPackageFormBusy] = useState(false);
  const [packageFormError, setPackageFormError] = useState<string | null>(null);
  const [packageActionBusyId, setPackageActionBusyId] = useState<string | null>(
    null,
  );
  const [packageDraft, setPackageDraft] = useState(defaultPackageDraft);

  const [loadingPatient, setLoadingPatient] = useState(true);
  const [patientReady, setPatientReady] = useState(false);
  const [patientLoadError, setPatientLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [pageTab, setPageTab] = useState<PageTab>(initialTab ?? "overview");
  const [eobHighlightDocId, setEobHighlightDocId] = useState<string | null>(null);
  const [piCasesEverOpened, setPiCasesEverOpened] = useState(false);
  const [headerStats, setHeaderStats] = useState<PatientHeaderStats | null>(null);
  const [headerStatsLoading, setHeaderStatsLoading] = useState(false);

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
      setAppointmentsError(null);
      setBillingError(null);
      setMembershipError(null);
      setSurveysError(null);

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

    },
    [patientId, clinicId],
  );

  const loadPackages = useCallback(async () => {
    if (!patientId || !clinicId) return;
    setPackagesLoading(true);
    setPackagesError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patient-packages?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(patientId)}`,
        { headers: h },
      );
      if (!res.ok) {
        setPackagesError(
          (await res.text().catch(() => "")).trim() ||
            `Could not load packages (${res.status})`,
        );
        setPackageRows([]);
        return;
      }
      const json = await res.json();
      setPackageRows(Array.isArray(json) ? json : []);
    } catch {
      setPackagesError("Could not load packages.");
      setPackageRows([]);
    } finally {
      setPackagesLoading(false);
    }
  }, [patientId, clinicId]);

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
    setPageTab(initialTab ?? "overview");
    setHeaderStats(null);
    setPiCasesEverOpened(false);
    setPiRows([]);
    setPiError(null);
    setAppointments([]);
    setBillingRows([]);
    setMembershipRows([]);
    setSurveyRows([]);
    setPackageRows([]);
    setPackagesError(null);
    setShowPackageForm(false);
    setPackageFormError(null);
    setPackageDraft(defaultPackageDraft());

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
  }, [patientId, clinicId, initialTab]);

  useEffect(() => {
    if (!patientReady || !patientId || !clinicId) return;
    let cancelled = false;
    void loadSecondaryResources(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [patientReady, patientId, clinicId, loadSecondaryResources]);

  useEffect(() => {
    if (pageTab !== "packages" || !patientReady) return;
    void loadPackages();
  }, [pageTab, patientReady, loadPackages]);

  const loadHeaderStats = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!patientId || !clinicId) return;
      setHeaderStatsLoading(true);
      try {
        const h = await authHeaders();
        if (isCancelled?.()) return;
        const res = await fetch(
          `${API_BASE}/api/patients/${encodeURIComponent(patientId)}/header-stats?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        if (isCancelled?.()) return;
        if (!res.ok) {
          setHeaderStats(null);
          return;
        }
        const json = (await res.json()) as PatientHeaderStats;
        if (isCancelled?.()) return;
        setHeaderStats(json);
      } catch {
        if (!isCancelled?.()) setHeaderStats(null);
      } finally {
        if (!isCancelled?.()) setHeaderStatsLoading(false);
      }
    },
    [patientId, clinicId],
  );

  useEffect(() => {
    if (!patientId || !clinicId) {
      setHeaderStats(null);
      setHeaderStatsLoading(false);
      return;
    }
    let cancelled = false;
    setHeaderStats(null);
    void loadHeaderStats(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [patientId, clinicId, loadHeaderStats]);

  useEffect(() => {
    if (pageTab !== "legal" || !patientReady || piCasesEverOpened) return;
    setPiCasesEverOpened(true);
    void loadPiCases();
  }, [pageTab, patientReady, piCasesEverOpened, loadPiCases]);

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
    { id: "appointments", label: "Appointments" },
    { id: "clinical", label: "Clinical" },
    { id: "billing", label: "Billing" },
    { id: "documents", label: "Documents" },
    { id: "performance", label: "Performance" },
    { id: "notes", label: "Notes" },
    { id: "legal", label: "Legal" },
    { id: "memberships", label: "Memberships" },
    { id: "packages", label: "Packages" },
    { id: "hep", label: "Home Exercise Programs" },
    { id: "benefits", label: "Benefits" },
  ];

  function setDraftField<K extends keyof PatientRecord>(
    key: K,
    value: PatientRecord[K],
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function beginEdit() {
    if (readOnly) return;
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
        "sport",
        "referral_source",
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
      void loadHeaderStats();
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

  const shellClass = embedded
    ? "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f0f4f8] px-4 pt-2 md:px-6"
    : "flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#f0f4f8] -mx-6 px-8 pt-8";

  if (loadingPatient && !patient) {
    return (
      <div className={shellClass}>
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
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse bg-white" />
          ))}
        </div>
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
    return (
      <div className={shellClass}>
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
        <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse bg-white" />
          ))}
        </div>
      </div>
    );
  }

  const display = editMode ? draft : patient;

  const patientDisplayId =
    headerStats?.patient_display_id ??
    `PT-${patientId.replace(/-/g, "").slice(-6).toUpperCase()}`;

  function renderEditProfileForm() {
    if (!draft) return null;
    const d = draft;
    return (
      <div className="mb-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">Address</h2>
          <div className="space-y-4">
            <div>
              <span className={LABEL_CLASS}>Line 1</span>
              <input
                className={FIELD_INPUT}
                value={d.address_line1 ?? ""}
                onChange={(e) => setDraftField("address_line1", e.target.value)}
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Line 2</span>
              <input
                className={FIELD_INPUT}
                value={d.address_line2 ?? ""}
                onChange={(e) => setDraftField("address_line2", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={LABEL_CLASS}>City</span>
                <input
                  className={FIELD_INPUT}
                  value={d.city ?? ""}
                  onChange={(e) => setDraftField("city", e.target.value)}
                />
              </div>
              <div>
                <span className={LABEL_CLASS}>State</span>
                <input
                  className={FIELD_INPUT}
                  value={d.state ?? ""}
                  onChange={(e) => setDraftField("state", e.target.value)}
                />
              </div>
            </div>
            <div>
              <span className={LABEL_CLASS}>ZIP</span>
              <input
                className={FIELD_INPUT}
                value={d.zip ?? ""}
                onChange={(e) => setDraftField("zip", e.target.value)}
              />
            </div>
          </div>
          <h2 className={`${DS_SECTION_HEADER} mt-8`}>Emergency contact</h2>
          <div className="space-y-4">
            <div>
              <span className={LABEL_CLASS}>Name</span>
              <input
                className={FIELD_INPUT}
                value={d.emergency_contact_name ?? ""}
                onChange={(e) =>
                  setDraftField("emergency_contact_name", e.target.value)
                }
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Phone</span>
              <input
                className={FIELD_INPUT}
                value={d.emergency_contact_phone ?? ""}
                onChange={(e) =>
                  setDraftField("emergency_contact_phone", e.target.value)
                }
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Relationship</span>
              <input
                className={FIELD_INPUT}
                value={d.emergency_contact_relationship ?? ""}
                onChange={(e) =>
                  setDraftField("emergency_contact_relationship", e.target.value)
                }
              />
            </div>
          </div>
        </div>

        <div className={DS_CARD}>
          <h2 className={DS_SECTION_HEADER}>Personal &amp; Insurance</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={LABEL_CLASS}>First name</span>
                <input
                  className={FIELD_INPUT}
                  value={d.first_name ?? ""}
                  onChange={(e) => setDraftField("first_name", e.target.value)}
                />
              </div>
              <div>
                <span className={LABEL_CLASS}>Last name</span>
                <input
                  className={FIELD_INPUT}
                  value={d.last_name ?? ""}
                  onChange={(e) => setDraftField("last_name", e.target.value)}
                />
              </div>
            </div>
            <div>
              <span className={LABEL_CLASS}>Email</span>
              <input
                className={FIELD_INPUT}
                value={d.email ?? ""}
                onChange={(e) => setDraftField("email", e.target.value)}
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Phone</span>
              <input
                className={FIELD_INPUT}
                value={d.phone ?? ""}
                onChange={(e) => setDraftField("phone", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={LABEL_CLASS}>Date of birth</span>
                <input
                  className={FIELD_INPUT}
                  value={d.date_of_birth ?? ""}
                  onChange={(e) => setDraftField("date_of_birth", e.target.value)}
                />
              </div>
              <div>
                <span className={LABEL_CLASS}>Gender</span>
                <input
                  className={FIELD_INPUT}
                  value={d.gender ?? ""}
                  onChange={(e) => setDraftField("gender", e.target.value)}
                />
              </div>
            </div>
            <div>
              <span className={LABEL_CLASS}>Carrier</span>
              <input
                className={FIELD_INPUT}
                value={d.insurance_carrier ?? ""}
                onChange={(e) => setDraftField("insurance_carrier", e.target.value)}
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Policy number</span>
              <input
                className={FIELD_INPUT}
                value={d.insurance_policy_number ?? ""}
                onChange={(e) =>
                  setDraftField("insurance_policy_number", e.target.value)
                }
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Group number</span>
              <input
                className={FIELD_INPUT}
                value={d.insurance_group_number ?? ""}
                onChange={(e) =>
                  setDraftField("insurance_group_number", e.target.value)
                }
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Primary complaint</span>
              <textarea
                className={`${FIELD_INPUT} min-h-[72px]`}
                value={d.primary_complaint ?? ""}
                onChange={(e) => setDraftField("primary_complaint", e.target.value)}
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Referring provider</span>
              <input
                className={FIELD_INPUT}
                value={d.referring_provider ?? ""}
                onChange={(e) => setDraftField("referring_provider", e.target.value)}
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Sport</span>
              <input
                className={FIELD_INPUT}
                value={d.sport ?? ""}
                onChange={(e) => setDraftField("sport", e.target.value)}
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>How did you hear about us?</span>
              <select
                className={FIELD_INPUT}
                value={d.referral_source ?? ""}
                onChange={(e) =>
                  setDraftField(
                    "referral_source",
                    e.target.value ? e.target.value : null,
                  )
                }
              >
                <option value="">— Select —</option>
                {REFERRAL_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  }

  async function createPackage() {
    if (!patientId || !clinicId) return;
    const name = packageDraft.package_name.trim();
    const totalVisits = Number(packageDraft.total_visits);
    const visitsAlreadyUsedRaw = packageDraft.visits_already_used.trim();
    const visitsAlreadyUsed =
      visitsAlreadyUsedRaw === "" ? 0 : Number(visitsAlreadyUsedRaw);
    const priceDollars = parseFloat(packageDraft.price_dollars);
    if (!name) {
      setPackageFormError("Package name is required.");
      return;
    }
    if (!Number.isFinite(totalVisits) || totalVisits <= 0) {
      setPackageFormError("Total visits must be a positive number.");
      return;
    }
    if (
      !Number.isFinite(visitsAlreadyUsed) ||
      !Number.isInteger(visitsAlreadyUsed) ||
      visitsAlreadyUsed < 0
    ) {
      setPackageFormError("Visits already used must be a non-negative whole number.");
      return;
    }
    if (visitsAlreadyUsed >= totalVisits) {
      setPackageFormError("Visits already used must be less than total visits.");
      return;
    }
    if (!Number.isFinite(priceDollars) || priceDollars < 0) {
      setPackageFormError("Price must be a valid dollar amount.");
      return;
    }
    if (!packageDraft.purchase_date.trim()) {
      setPackageFormError("Purchase date is required.");
      return;
    }

    setPackageFormBusy(true);
    setPackageFormError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(`${API_BASE}/patient-packages`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          patient_id: patientId,
          clinic_id: clinicId,
          package_name: name,
          total_visits: Math.round(totalVisits),
          visits_used: visitsAlreadyUsed,
          price_cents: Math.round(priceDollars * 100),
          purchase_date: packageDraft.purchase_date,
          notes: packageDraft.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        setPackageFormError(
          (await res.text().catch(() => "")).trim() ||
            `Could not create package (${res.status})`,
        );
        return;
      }
      setShowPackageForm(false);
      setPackageDraft(defaultPackageDraft());
      await loadPackages();
    } catch {
      setPackageFormError("Could not create package.");
    } finally {
      setPackageFormBusy(false);
    }
  }

  async function cancelPackageRow(row: PackageRow) {
    const label = (row.package_name ?? "").trim() || "this package";
    if (
      !window.confirm(
        `Cancel package "${label}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setPackageActionBusyId(row.id);
    setPackagesError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patient-packages/${encodeURIComponent(row.id)}`,
        {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ status: "cancelled" }),
        },
      );
      if (!res.ok) {
        setPackagesError(
          (await res.text().catch(() => "")).trim() ||
            `Could not cancel package (${res.status})`,
        );
        return;
      }
      await loadPackages();
    } catch {
      setPackagesError("Could not cancel package.");
    } finally {
      setPackageActionBusyId(null);
    }
  }

  function renderComingSoon(label: string) {
    return (
      <div className={`${DS_CARD} py-16 text-center`}>
        <p className="text-sm font-medium text-gray-500">{label} — Coming soon</p>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="shrink-0">
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

        <PatientHeader
          patient={display}
          patientDisplayId={patientDisplayId}
          onEditProfile={beginEdit}
          editMode={editMode}
          onSave={() => void saveEdit()}
          onCancel={cancelEdit}
          saveBusy={saveBusy}
          readOnly={readOnly}
        />

        <PatientQuickStats stats={headerStats} loading={headerStatsLoading} />

        {patientReady ? (
          <DiagnosticRedFlagBanner patientId={patientId} clinicId={clinicId} />
        ) : null}

        <div className="border-b border-gray-200 bg-[#f0f4f8]">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Patient sections">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
      {actionError ? (
        <p className="mb-4 rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {actionError}
        </p>
      ) : null}

      {pageTab === "overview" ? (
        <>
          {editMode ? (
            renderEditProfileForm()
          ) : headerStats ? (
            <PatientOverviewTab
              patient={patient}
              stats={headerStats}
              onEditProfile={beginEdit}
              readOnly={readOnly}
            />
          ) : headerStatsLoading ? (
            <div className={`${DS_CARD} mb-6`}>
              <CardSkeleton lines={12} />
            </div>
          ) : null}

          <div className={`mt-6 ${DS_CARD}`}>
            <h2 className={DS_SECTION_HEADER}>Visit Timeline</h2>
            <PatientVisitTimeline
              patientId={patientId}
              clinicId={clinicId}
              patientDisplayName={patientDisplayName(patient)}
            />
          </div>
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

      {pageTab === "appointments" ? (
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

      {pageTab === "billing" ? (
        <div className="space-y-8">
        <div className={DS_TABLE_WRAP}>
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
                    const rowKey = row.id ?? `${row.date_of_service}-${idx}`;
                    const st = (row.status ?? "").toLowerCase();
                    const clickable = !!row.id;
                    return (
                      <tr
                        key={rowKey}
                        className={
                          clickable
                            ? `${DS_TR} cursor-pointer`
                            : DS_TR
                        }
                        onClick={
                          clickable
                            ? () => setBillingDetailRecordId(row.id!)
                            : undefined
                        }
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setBillingDetailRecordId(row.id!);
                                }
                              }
                            : undefined
                        }
                      >
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
        <InsuranceBenefitsLedger patientId={patientId} clinicId={clinicId} />
        <BillingRecordDetailModal
          recordId={billingDetailRecordId}
          isOpen={billingDetailRecordId != null}
          onClose={() => setBillingDetailRecordId(null)}
          onRecordUpdated={() => void loadSecondaryResources(() => false)}
        />
        </div>
      ) : null}

      {pageTab === "memberships" ? (
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

      {pageTab === "packages" ? (
        <div className="mt-8 space-y-8">
          {packagesError ? (
            <InlineSectionError message={packagesError} />
          ) : null}

          {showPackageForm ? (
            <div className={DS_CARD}>
              <h2 className={DS_SECTION_HEADER}>New package</h2>
              {packageFormError ? (
                <div className="mb-4">
                  <InlineSectionError message={packageFormError} />
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <span className={LABEL_CLASS}>Package name</span>
                  <input
                    className={FIELD_INPUT}
                    value={packageDraft.package_name}
                    onChange={(e) =>
                      setPackageDraft((d) => ({
                        ...d,
                        package_name: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <span className={LABEL_CLASS}>Total visits</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={FIELD_INPUT}
                    value={packageDraft.total_visits}
                    onChange={(e) =>
                      setPackageDraft((d) => ({
                        ...d,
                        total_visits: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <span className={LABEL_CLASS}>Visits already used</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    className={FIELD_INPUT}
                    value={packageDraft.visits_already_used}
                    onChange={(e) =>
                      setPackageDraft((d) => ({
                        ...d,
                        visits_already_used: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <span className={LABEL_CLASS}>Price</span>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                      $
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={`${FIELD_INPUT} pl-7`}
                      value={packageDraft.price_dollars}
                      onChange={(e) =>
                        setPackageDraft((d) => ({
                          ...d,
                          price_dollars: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <span className={LABEL_CLASS}>Purchase date</span>
                  <input
                    type="date"
                    className={FIELD_INPUT}
                    value={packageDraft.purchase_date}
                    onChange={(e) =>
                      setPackageDraft((d) => ({
                        ...d,
                        purchase_date: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <span className={LABEL_CLASS}>Notes</span>
                  <textarea
                    rows={3}
                    className={FIELD_INPUT}
                    value={packageDraft.notes}
                    onChange={(e) =>
                      setPackageDraft((d) => ({ ...d, notes: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={packageFormBusy}
                  onClick={() => void createPackage()}
                  className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
                >
                  {packageFormBusy ? "Saving…" : "Create package"}
                </button>
                <button
                  type="button"
                  disabled={packageFormBusy}
                  onClick={() => {
                    setShowPackageForm(false);
                    setPackageFormError(null);
                    setPackageDraft(defaultPackageDraft());
                  }}
                  className={DS_SECONDARY_BTN}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className={DS_TABLE_WRAP}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-6 py-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.05em] text-gray-500">
                Visit packages
              </h2>
              {!showPackageForm && !readOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    setPackageFormError(null);
                    setPackageDraft(defaultPackageDraft());
                    setShowPackageForm(true);
                  }}
                  className={DS_PRIMARY_BTN}
                >
                  New Package
                </button>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className={DS_TABLE_HEAD}>
                  <tr>
                    <th className={DS_TH}>Package</th>
                    <th className={DS_TH}>Total visits</th>
                    <th className={DS_TH}>Used</th>
                    <th className={DS_TH}>Remaining</th>
                    <th className={DS_TH}>Status</th>
                    <th className={DS_TH}>Purchase date</th>
                    <th className={DS_TH} />
                  </tr>
                </thead>
                <tbody>
                  {packagesLoading ? (
                    <TableSkeleton cols={7} rows={4} />
                  ) : packageRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-6 py-10 text-center text-gray-500"
                      >
                        No visit packages for this patient.
                      </td>
                    </tr>
                  ) : (
                    packageRows.map((row) => {
                      const total = Number(row.total_visits) || 0;
                      const used = Number(row.visits_used) || 0;
                      const remaining = Math.max(0, total - used);
                      const st = (row.status ?? "").toLowerCase();
                      const isActive = st === "active";
                      return (
                        <tr key={row.id} className={DS_TR}>
                          <td className={DS_TD_PRIMARY}>
                            {(row.package_name ?? "").trim() || "—"}
                          </td>
                          <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                            {total}
                          </td>
                          <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                            {used}
                          </td>
                          <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                            {remaining}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <span
                              className={membershipStatusBadgeClass(
                                row.status ?? "",
                              )}
                            >
                              {row.status ?? "—"}
                            </span>
                          </td>
                          <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                            {formatDob(row.purchase_date)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {isActive && !readOnly ? (
                              <button
                                type="button"
                                disabled={packageActionBusyId === row.id}
                                onClick={() => void cancelPackageRow(row)}
                                className={`${DS_SECONDARY_BTN} disabled:opacity-50`}
                              >
                                {packageActionBusyId === row.id
                                  ? "Cancelling…"
                                  : "Cancel"}
                              </button>
                            ) : (
                              "—"
                            )}
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
      ) : null}

      {pageTab === "benefits" ? (
        <InsuranceBenefitsLedger patientId={patientId} clinicId={clinicId} />
      ) : null}

      {pageTab === "clinical" ? (
        <div className="space-y-8">
          <DmeSection clinicId={clinicId} patientId={patientId} />
          <DiagnosticsTab
            patientId={patientId}
            clinicId={clinicId}
            highlightDocumentId={eobHighlightDocId}
          />
        </div>
      ) : null}

      {pageTab === "documents" ? (
        <PatientDocumentsTab
          patientId={patientId}
          clinicId={clinicId}
          onViewEobAnalysis={(documentId) => {
            setEobHighlightDocId(documentId);
            setPageTab("clinical");
          }}
        />
      ) : null}

      {pageTab === "performance" ? (
        <PatientPerformanceTab
          patientId={patientId}
          clinicId={clinicId}
          patientName={patientDisplayName(patient)}
        />
      ) : null}

      {pageTab === "notes" ? renderComingSoon("Notes") : null}

      {pageTab === "legal" ? (
        <>
          <div className="relative mb-6 rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                Legal / PI Information
              </h2>
              {!legalEdit && !readOnly ? (
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
            ) : !readOnly ? (
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
            ) : (
              <p className="text-sm text-gray-500">No legal information on file.</p>
            )}
          </div>
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
        </>
      ) : null}

      {pageTab === "hep" ? (
        <PatientHEPTab
          patientId={patientId}
          clinicId={clinicId}
          active={pageTab === "hep"}
        />
      ) : null}
      </div>
    </div>
  );
}

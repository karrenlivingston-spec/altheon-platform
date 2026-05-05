"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

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

import { useClinic } from "@/app/admin/ClinicContext";

const API_BASE = "https://altheon-platform.onrender.com";

const NY = "America/New_York";

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

export default function PatientDetailPage() {
  const { clinicId } = useClinic();
  const params = useParams();
  const router = useRouter();
  const patientId = typeof params.id === "string" ? params.id : "";

  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [draft, setDraft] = useState<PatientRecord | null>(null);
  const [appointments, setAppointments] = useState<AppointmentListRow[]>([]);
  const [billingRows, setBillingRows] = useState<BillingRow[]>([]);
  const [membershipRows, setMembershipRows] = useState<MembershipRow[]>([]);
  const [piRows, setPiRows] = useState<PiCaseRow[]>([]);
  const [surveyRows, setSurveyRows] = useState<SurveyResponseRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [tab, setTab] = useState<
    "overview" | "appointments" | "billing" | "membership"
  >("overview");

  const load = useCallback(async (silent = false) => {
    if (!patientId) return;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [
        ptRes,
        apRes,
        brRes,
        memRes,
        piRes,
        surveyRes,
      ] = await Promise.all([
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/appointments?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/billing-records?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(patientId)}`,
        ),
        fetch(
          `${API_BASE}/patient-memberships?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(patientId)}`,
        ),
        fetch(
          `${API_BASE}/pi-cases?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(patientId)}`,
        ),
        fetch(
          `${API_BASE}/patients/${encodeURIComponent(patientId)}/surveys?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
      ]);

      if (!ptRes.ok) {
        if (!silent) {
          setPatient(null);
          setDraft(null);
          setError(
            ptRes.status === 404 ? "Patient not found." : `Error ${ptRes.status}`,
          );
        }
        return;
      }
      const ptJson = (await ptRes.json()) as PatientRecord;
      setPatient(ptJson);
      setDraft({ ...ptJson });

      const apJson = apRes.ok ? await apRes.json() : [];
      const allAp = Array.isArray(apJson) ? apJson : [];
      setAppointments(
        allAp.filter(
          (a: AppointmentListRow) => a.patient_id === patientId,
        ) as AppointmentListRow[],
      );

      const brJson = brRes.ok ? await brRes.json() : [];
      setBillingRows(Array.isArray(brJson) ? brJson : []);

      const memJson = memRes.ok ? await memRes.json() : [];
      setMembershipRows(Array.isArray(memJson) ? memJson : []);

      const piJson = piRes.ok ? await piRes.json() : [];
      setPiRows(Array.isArray(piJson) ? piJson : []);

      const surveyJson = surveyRes.ok ? await surveyRes.json() : [];
      setSurveyRows(Array.isArray(surveyJson) ? surveyJson : []);
    } catch {
      if (!silent) {
        setError("Could not load patient.");
        setPatient(null);
        setDraft(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [patientId, clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

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
    setError(null);
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => "Save failed"));
        return;
      }
      const data = (await res.json()) as Record<string, unknown>;
      const {
        appointments: _a,
        billing_records: _b,
        memberships: _m,
        pi_cases: _p,
        ...patientFields
      } = data;
      setPatient(patientFields as PatientRecord);
      setDraft({ ...(patientFields as PatientRecord) });
      await load(true);
      setEditMode(false);
    } catch {
      setError("Save failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  if (!patientId) {
    return (
      <div className="text-sm text-gray-600">Invalid patient id.</div>
    );
  }

  if (loading && !patient) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white px-6 py-12 text-center text-gray-500 shadow-sm">
        Loading…
      </div>
    );
  }

  if (error && !patient) {
    return (
      <div className="space-y-4">
        <p className="rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
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

  const tabs: { id: typeof tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "appointments", label: "Appointments" },
    { id: "billing", label: "Billing" },
    { id: "membership", label: "Memberships & PI Cases" },
  ];

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => router.push("/admin/patients")}
          className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
        >
          ← Patients
        </button>
      </div>

      <div className="mb-8 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
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

      {error ? (
        <p className="mb-4 rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-100 pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-[#16A34A] text-[#16A34A]"
                : "text-gray-500 hover:text-gray-800",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
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
        </div>
      ) : null}

      {tab === "appointments" ? (
        <div className={`${DS_TABLE_WRAP} mt-8`}>
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
                {appointmentTableRows.length === 0 ? (
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

      {tab === "billing" ? (
        <div className={`${DS_TABLE_WRAP} mt-8`}>
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
                {billingRows.length === 0 ? (
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

      {tab === "membership" ? (
        <div className="mt-8 space-y-8">
          <div className={DS_CARD}>
            <h2 className={DS_SECTION_HEADER}>Active membership</h2>
            {!activeMembership ? (
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

          <div className={DS_TABLE_WRAP}>
            <div className="border-b border-gray-100 bg-gray-50 px-6 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
                PI cases
              </h2>
            </div>
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
                  {piRows.length === 0 ? (
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

          <div className="mt-8">
            <h2 className={DS_SECTION_HEADER}>Surveys</h2>
            {completedSurveys.length === 0 ? (
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
    </div>
  );
}

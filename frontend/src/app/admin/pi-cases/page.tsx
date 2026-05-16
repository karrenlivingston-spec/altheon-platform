"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";

import {
  billingStatusBadgeClass,
  billingTypePillClass,
  DS_CARD,
  DS_FILTER_BAR,
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
  piCaseStatusBadgeClass,
} from "@/app/admin/designSystem";

import { useClinic } from "@/app/admin/ClinicContext";

const API_BASE = "https://altheon-platform.onrender.com";

type PatientRow = {
  id: string;
  first_name?: string;
  last_name?: string;
};

type PiCaseRow = {
  id: string;
  clinic_id?: string;
  patient_id: string;
  status?: string;
  date_of_accident?: string | null;
  claim_number?: string | null;
  attorney_name?: string | null;
  attorney_email?: string | null;
  attorney_phone?: string | null;
  insurance_carrier?: string | null;
  notes?: string | null;
  created_at?: string;
};

type BillingRecordRow = {
  id: string;
  patient_id: string;
  pi_case_id?: string | null;
  date_of_service?: string;
  billing_type?: string;
  status?: string;
  total_billed_cents?: number | null;
};

type PiReferralRow = {
  id: string;
  pi_case_id?: string;
  referral_type?: string | null;
  referral_type_other?: string | null;
  status?: string | null;
  referral_date?: string | null;
  provider_specialist?: string | null;
  records_received?: boolean | null;
  records_received_date?: string | null;
  follow_up_status?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const REFERRAL_TYPE_OPTIONS = [
  { value: "emc", label: "EMC Evaluation" },
  { value: "mri", label: "MRI" },
  { value: "orthopedic", label: "Orthopedic Referral" },
  { value: "neurology", label: "Neurology Referral" },
  { value: "podiatry", label: "Podiatry Referral" },
  { value: "other", label: "Other" },
] as const;

const REFERRAL_STATUS_EDIT_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "referred", label: "Referred" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_treatment", label: "In Treatment" },
  { value: "pending_settlement", label: "Pending Settlement" },
  { value: "settled", label: "Settled" },
  { value: "closed", label: "Closed" },
] as const;

const PI_STATUS_OPTIONS = [
  "open",
  "in_treatment",
  "pending_settlement",
  "settled",
  "closed",
] as const;

function patientDisplayName(p: PatientRow): string {
  const s = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return s || "—";
}

function formatUsdFromCents(cents: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
}

function formatAccidentDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd.trim());
  if (!m) return ymd;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

function compareCreatedDesc(a: PiCaseRow, b: PiCaseRow): number {
  const ta = new Date(a.created_at ?? 0).getTime();
  const tb = new Date(b.created_at ?? 0).getTime();
  return tb - ta;
}

function dash(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  return t || "—";
}

function referralTypeLabel(row: PiReferralRow): string {
  const t = (row.referral_type ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    emc: "EMC Evaluation",
    mri: "MRI",
    orthopedic: "Orthopedic Referral",
    neurology: "Neurology Referral",
    podiatry: "Podiatry Referral",
  };
  if (t === "other") {
    const o = (row.referral_type_other ?? "").trim();
    return o || "Other";
  }
  return map[t] ?? (t || "—");
}

function referralStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "pending") {
    return "inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800";
  }
  if (s === "referred") {
    return "inline-flex rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-800";
  }
  if (s === "completed") {
    return "inline-flex rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800";
  }
  if (s === "cancelled") {
    return "inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600";
  }
  return "inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600";
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : `${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseYmdOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatDisplayDate(value: string | null | undefined): string {
  const d = parseYmdOnly(value) ?? parseIsoDate(value);
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function referralNeedsWarning(row: PiReferralRow): boolean {
  const st = (row.status ?? "").toLowerCase();
  if (st === "pending" && row.created_at) {
    const created = parseIsoDate(row.created_at);
    if (created) {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (created.getTime() < cutoff) return true;
    }
  }
  if (row.records_received !== true && row.referral_date) {
    const rd = parseYmdOnly(row.referral_date);
    if (rd) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      if (rd < cutoff) return true;
    }
  }
  return false;
}

export default function AdminPiCasesPage() {
  const { clinicId } = useClinic();
  const [cases, setCases] = useState<PiCaseRow[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [billingRecords, setBillingRecords] = useState<BillingRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [cPatientId, setCPatientId] = useState("");
  const [cDateAccident, setCDateAccident] = useState("");
  const [cInsurance, setCInsurance] = useState("");
  const [cClaim, setCClaim] = useState("");
  const [cAttorneyName, setCAttorneyName] = useState("");
  const [cAttorneyEmail, setCAttorneyEmail] = useState("");
  const [cAttorneyPhone, setCAttorneyPhone] = useState("");
  const [cNotes, setCNotes] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState("open");
  const [statusBusy, setStatusBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState({
    date_of_accident: "",
    insurance_carrier: "",
    claim_number: "",
    attorney_name: "",
    attorney_email: "",
    attorney_phone: "",
    notes: "",
  });
  const [editBusy, setEditBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [referrals, setReferrals] = useState<PiReferralRow[]>([]);
  const [referralsLoading, setReferralsLoading] = useState(false);

  const [addReferralOpen, setAddReferralOpen] = useState(false);
  const [addRefType, setAddRefType] = useState<string>("emc");
  const [addRefOther, setAddRefOther] = useState("");
  const [addRefDate, setAddRefDate] = useState("");
  const [addRefProvider, setAddRefProvider] = useState("");
  const [addRefNotes, setAddRefNotes] = useState("");
  const [addRefBusy, setAddRefBusy] = useState(false);

  const [editReferralOpen, setEditReferralOpen] = useState(false);
  const [editingReferral, setEditingReferral] = useState<PiReferralRow | null>(
    null,
  );
  const [editRefType, setEditRefType] = useState("");
  const [editRefOther, setEditRefOther] = useState("");
  const [editRefDate, setEditRefDate] = useState("");
  const [editRefProvider, setEditRefProvider] = useState("");
  const [editRefNotes, setEditRefNotes] = useState("");
  const [editRefStatus, setEditRefStatus] = useState("pending");
  const [editRefRecordsReceived, setEditRefRecordsReceived] = useState(false);
  const [editRefRecordsDate, setEditRefRecordsDate] = useState("");
  const [editRefFollowUp, setEditRefFollowUp] = useState("");
  const [editRefBusy, setEditRefBusy] = useState(false);

  const patientById = useMemo(() => {
    const m = new Map<string, PatientRow>();
    for (const p of patients) m.set(p.id, p);
    return m;
  }, [patients]);

  const loadData = useCallback(async (): Promise<PiCaseRow[]> => {
    setLoading(true);
    setError(null);
    let piList: PiCaseRow[] = [];
    try {
      const [piRes, ptRes, brRes] = await Promise.all([
        fetch(`${API_BASE}/pi-cases?clinic_id=${encodeURIComponent(clinicId)}`),
        fetch(`${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}`),
        fetch(`${API_BASE}/billing-records?clinic_id=${encodeURIComponent(clinicId)}`),
      ]);
      const piJson = piRes.ok ? await piRes.json() : [];
      const ptJson = ptRes.ok ? await ptRes.json() : [];
      const brJson = brRes.ok ? await brRes.json() : [];
      piList = Array.isArray(piJson) ? piJson : [];
      setCases(piList);
      setPatients(Array.isArray(ptJson) ? ptJson : []);
      setBillingRecords(Array.isArray(brJson) ? brJson : []);
      if (!piRes.ok) {
        setError(`PI cases: HTTP ${piRes.status}`);
      } else if (!ptRes.ok) {
        setError(`Patients: HTTP ${ptRes.status}`);
      } else if (!brRes.ok) {
        setError(`Billing records: HTTP ${brRes.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      setCases([]);
      setPatients([]);
      setBillingRecords([]);
      piList = [];
    } finally {
      setLoading(false);
    }
    return piList;
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const tableRows = useMemo(() => {
    let list = cases;
    if (statusFilter) {
      list = list.filter(
        (c) => (c.status ?? "").toLowerCase() === statusFilter.toLowerCase(),
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        const p = patientById.get(c.patient_id);
        const name = p ? patientDisplayName(p).toLowerCase() : "";
        const ins = (c.insurance_carrier ?? "").toLowerCase();
        return name.includes(q) || ins.includes(q);
      });
    }
    return [...list].sort(compareCreatedDesc);
  }, [cases, statusFilter, search, patientById]);

  const activeCase = useMemo(
    () => (detailId ? cases.find((c) => c.id === detailId) ?? null : null),
    [cases, detailId],
  );

  const linkedBilling = useMemo(() => {
    if (!detailId) return [];
    return billingRecords
      .filter((r) => r.pi_case_id === detailId)
      .sort((a, b) =>
        (b.date_of_service ?? "").localeCompare(a.date_of_service ?? ""),
      );
  }, [billingRecords, detailId]);

  function openCreate() {
    setCPatientId("");
    setCDateAccident("");
    setCInsurance("");
    setCClaim("");
    setCAttorneyName("");
    setCAttorneyEmail("");
    setCAttorneyPhone("");
    setCNotes("");
    setCreateOpen(true);
  }

  function clearFilters() {
    setStatusFilter("");
    setSearch("");
  }

  function syncEditFromCase(c: PiCaseRow) {
    setEditDraft({
      date_of_accident: c.date_of_accident
        ? String(c.date_of_accident).slice(0, 10)
        : "",
      insurance_carrier: c.insurance_carrier ?? "",
      claim_number: c.claim_number ?? "",
      attorney_name: c.attorney_name ?? "",
      attorney_email: c.attorney_email ?? "",
      attorney_phone: c.attorney_phone ?? "",
      notes: c.notes ?? "",
    });
    setStatusDraft((c.status ?? "open").toLowerCase());
  }

  function openDetail(c: PiCaseRow) {
    setDetailId(c.id);
    setEditMode(false);
    setDetailError(null);
    syncEditFromCase(c);
  }

  function closeDetail() {
    setDetailId(null);
    setEditMode(false);
    setDetailError(null);
    setReferrals([]);
    setAddReferralOpen(false);
    setEditReferralOpen(false);
    setEditingReferral(null);
  }

  const loadReferrals = useCallback(async () => {
    if (!detailId || !activeCase?.patient_id) return;
    setReferralsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/patients/${encodeURIComponent(activeCase.patient_id)}/pi-case`,
      );
      if (!res.ok) {
        setReferrals([]);
        return;
      }
      const data = (await res.json()) as {
        id?: string;
        pi_referrals?: PiReferralRow[];
      };
      const raw = Array.isArray(data.pi_referrals) ? data.pi_referrals : [];
      const filtered = raw.filter(
        (r) => String(r.pi_case_id ?? "") === String(detailId),
      );
      setReferrals(filtered);
    } catch {
      setReferrals([]);
    } finally {
      setReferralsLoading(false);
    }
  }, [detailId, activeCase?.patient_id]);

  useEffect(() => {
    if (detailId && activeCase?.patient_id) {
      void loadReferrals();
    }
  }, [detailId, activeCase?.patient_id, loadReferrals]);

  function openAddReferral() {
    setAddRefType("emc");
    setAddRefOther("");
    setAddRefDate("");
    setAddRefProvider("");
    setAddRefNotes("");
    setAddReferralOpen(true);
  }

  async function submitAddReferral() {
    if (!detailId) return;
    const t = addRefType.trim().toLowerCase();
    if (t === "other" && !addRefOther.trim()) {
      setDetailError("Enter a label when referral type is Other.");
      return;
    }
    setAddRefBusy(true);
    setDetailError(null);
    try {
      const body: Record<string, unknown> = {
        referral_type: t,
      };
      if (t === "other") {
        body.referral_type_other = addRefOther.trim();
      }
      if (addRefDate.trim()) body.referral_date = addRefDate.trim();
      if (addRefProvider.trim()) {
        body.provider_specialist = addRefProvider.trim();
      }
      if (addRefNotes.trim()) body.notes = addRefNotes.trim();

      const res = await fetch(
        `${API_BASE}/api/pi-cases/${encodeURIComponent(detailId)}/referrals`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setDetailError(await res.text().catch(() => res.statusText));
        return;
      }
      setAddReferralOpen(false);
      await loadReferrals();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to add referral");
    } finally {
      setAddRefBusy(false);
    }
  }

  function openEditReferral(row: PiReferralRow) {
    setEditingReferral(row);
    const rt = (row.referral_type ?? "emc").trim().toLowerCase();
    setEditRefType(rt);
    setEditRefOther(row.referral_type_other ?? "");
    setEditRefDate(
      row.referral_date ? String(row.referral_date).slice(0, 10) : "",
    );
    setEditRefProvider(row.provider_specialist ?? "");
    setEditRefNotes(row.notes ?? "");
    setEditRefStatus((row.status ?? "pending").toLowerCase());
    setEditRefRecordsReceived(Boolean(row.records_received));
    setEditRefRecordsDate(
      row.records_received_date
        ? String(row.records_received_date).slice(0, 10)
        : "",
    );
    setEditRefFollowUp(row.follow_up_status ?? "");
    setEditReferralOpen(true);
  }

  async function submitEditReferral() {
    if (!editingReferral) return;
    const t = editRefType.trim().toLowerCase();
    if (t === "other" && !editRefOther.trim()) {
      setDetailError("Enter a label when referral type is Other.");
      return;
    }
    setEditRefBusy(true);
    setDetailError(null);
    try {
      const body: Record<string, unknown> = {
        referral_type: t,
        status: editRefStatus,
        records_received: editRefRecordsReceived,
        follow_up_status: editRefFollowUp.trim() || null,
        notes: editRefNotes.trim() || null,
      };
      if (t === "other") {
        body.referral_type_other = editRefOther.trim();
      } else {
        body.referral_type_other = null;
      }
      body.referral_date = editRefDate.trim() || null;
      body.provider_specialist = editRefProvider.trim() || null;
      if (editRefRecordsReceived) {
        body.records_received_date = editRefRecordsDate.trim()
          ? editRefRecordsDate.trim()
          : undefined;
      } else {
        body.records_received_date = null;
      }

      const res = await fetch(
        `${API_BASE}/api/pi-referrals/${encodeURIComponent(editingReferral.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setDetailError(await res.text().catch(() => res.statusText));
        return;
      }
      setEditReferralOpen(false);
      setEditingReferral(null);
      await loadReferrals();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to update referral");
    } finally {
      setEditRefBusy(false);
    }
  }

  async function deleteReferral(row: PiReferralRow) {
    if (
      !window.confirm(
        "Delete this referral milestone? This cannot be undone.",
      )
    ) {
      return;
    }
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/pi-referrals/${encodeURIComponent(row.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        setDetailError(await res.text().catch(() => res.statusText));
        return;
      }
      await loadReferrals();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function submitCreate() {
    if (!cPatientId) {
      setError("Select a patient.");
      return;
    }
    setCreateBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        clinic_id: clinicId,
        patient_id: cPatientId,
      };
      if (cDateAccident) body.date_of_accident = cDateAccident;
      if (cInsurance.trim()) body.insurance_carrier = cInsurance.trim();
      if (cClaim.trim()) body.claim_number = cClaim.trim();
      if (cAttorneyName.trim()) body.attorney_name = cAttorneyName.trim();
      if (cAttorneyEmail.trim()) body.attorney_email = cAttorneyEmail.trim();
      if (cAttorneyPhone.trim()) body.attorney_phone = cAttorneyPhone.trim();
      if (cNotes.trim()) body.notes = cNotes.trim();

      const res = await fetch(`${API_BASE}/pi-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setCreateOpen(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  async function updateStatus() {
    if (!detailId) return;
    setStatusBusy(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/pi-cases/${encodeURIComponent(detailId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: statusDraft }),
        },
      );
      if (!res.ok) {
        setDetailError(await res.text().catch(() => res.statusText));
        return;
      }
      const piList = await loadData();
      const row = piList.find((c) => c.id === detailId);
      if (row) setStatusDraft((row.status ?? "open").toLowerCase());
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setStatusBusy(false);
    }
  }

  async function saveEdit() {
    if (!detailId) return;
    setEditBusy(true);
    setDetailError(null);
    try {
      const body: Record<string, unknown> = {
        date_of_accident: editDraft.date_of_accident.trim() || null,
        insurance_carrier: editDraft.insurance_carrier.trim() || null,
        claim_number: editDraft.claim_number.trim() || null,
        attorney_name: editDraft.attorney_name.trim() || null,
        attorney_email: editDraft.attorney_email.trim() || null,
        attorney_phone: editDraft.attorney_phone.trim() || null,
        notes: editDraft.notes.trim() || null,
      };
      const res = await fetch(
        `${API_BASE}/pi-cases/${encodeURIComponent(detailId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setDetailError(await res.text().catch(() => res.statusText));
        return;
      }
      setEditMode(false);
      const piList = await loadData();
      const row = piList.find((c) => c.id === detailId);
      if (row) syncEditFromCase(row);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setEditBusy(false);
    }
  }

  function cancelEdit() {
    if (activeCase) syncEditFromCase(activeCase);
    setEditMode(false);
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>PI Cases</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Personal injury case management
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className={`${DS_PRIMARY_BTN} inline-flex shrink-0 items-center justify-center`}
        >
          + New PI Case
        </button>
      </div>

      {error ? (
        <p className="mt-8 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className={`${DS_FILTER_BAR} mt-8 flex flex-wrap items-end gap-4`}>
        <label className="block text-sm font-medium text-gray-700">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 block h-9 w-52 rounded-lg border border-gray-100 bg-white px-3 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-[12rem] flex-1 text-sm font-medium text-gray-700">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Patient name or insurance carrier…"
            className={`mt-1 h-9 w-full ${DS_INPUT}`}
          />
        </label>
        <button
          type="button"
          onClick={clearFilters}
          className={DS_SECONDARY_BTN}
        >
          Clear filters
        </button>
      </div>

      <div className={`${DS_TABLE_WRAP} mt-8`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Patient Name</th>
                <th className={DS_TH}>Insurance Carrier</th>
                <th className={DS_TH}>Claim Number</th>
                <th className={DS_TH}>Attorney</th>
                <th className={DS_TH}>Date of Accident</th>
                <th className={DS_TH}>Status</th>
                <th className={`${DS_TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    No PI cases found
                  </td>
                </tr>
              ) : (
                tableRows.map((c) => {
                  const p = patientById.get(c.patient_id);
                  const name = p ? patientDisplayName(p) : "—";
                  const st = (c.status ?? "open").toLowerCase();
                  return (
                    <tr key={c.id} className={DS_TR}>
                      <td className={DS_TD_PRIMARY}>{name}</td>
                      <td className={DS_TD_PRIMARY}>
                        {dash(c.insurance_carrier)}
                      </td>
                      <td className={`${DS_TD_PRIMARY} font-mono text-xs`}>
                        {dash(c.claim_number)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {dash(c.attorney_name)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {formatAccidentDate(c.date_of_accident ?? undefined)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <span className={`capitalize ${piCaseStatusBadgeClass(st)}`}>
                          {st.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className={`${DS_TD_PRIMARY} text-right`}>
                        <button
                          type="button"
                          onClick={() => openDetail(c)}
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

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="pi-create-title"
          >
            <h2
              id="pi-create-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              New PI Case
            </h2>
            <div className="space-y-4 pt-5">
              <label className="block text-sm font-medium text-gray-700">
                Patient
                <select
                  value={cPatientId}
                  onChange={(e) => setCPatientId(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                >
                  <option value="">Select patient…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {patientDisplayName(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Date of Accident (optional)
                <input
                  type="date"
                  value={cDateAccident}
                  onChange={(e) => setCDateAccident(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-gray-100 px-3 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Insurance Carrier (optional)
                <input
                  type="text"
                  value={cInsurance}
                  onChange={(e) => setCInsurance(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Claim Number (optional)
                <input
                  type="text"
                  value={cClaim}
                  onChange={(e) => setCClaim(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Attorney Name (optional)
                <input
                  type="text"
                  value={cAttorneyName}
                  onChange={(e) => setCAttorneyName(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Attorney Email (optional)
                <input
                  type="email"
                  value={cAttorneyEmail}
                  onChange={(e) => setCAttorneyEmail(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Attorney Phone (optional)
                <input
                  type="text"
                  value={cAttorneyPhone}
                  onChange={(e) => setCAttorneyPhone(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
                <textarea
                  value={cNotes}
                  onChange={(e) => setCNotes(e.target.value)}
                  rows={3}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createBusy}
                onClick={() => void submitCreate()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
              >
                {createBusy ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailId && activeCase ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDetail();
          }}
          role="presentation"
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            role="dialog"
            aria-modal
            aria-labelledby="pi-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <h2
                id="pi-detail-title"
                className="text-lg font-semibold text-gray-900"
              >
                PI Case
              </h2>
              <button
                type="button"
                onClick={closeDetail}
                className="rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {detailError ? (
              <p className="mt-4 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
                {detailError}
              </p>
            ) : null}

            <div className={`mt-5 ${DS_CARD}`}>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Patient
              </p>
              <p className="text-2xl font-semibold text-gray-900">
                {patientDisplayName(
                  patientById.get(activeCase.patient_id) ?? {
                    id: activeCase.patient_id,
                    first_name: "",
                    last_name: "",
                  },
                )}
              </p>

              {!editMode ? (
                <>
                  <div className="mt-6 grid gap-6 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-gray-500">Date of accident</p>
                      <p className="text-sm font-medium text-gray-900">
                        {formatAccidentDate(activeCase.date_of_accident ?? undefined)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Insurance carrier</p>
                      <p className="text-sm font-medium text-gray-900">
                        {dash(activeCase.insurance_carrier)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Claim number</p>
                      <p className="text-sm font-medium text-gray-900">
                        {dash(activeCase.claim_number)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 grid gap-6 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-gray-500">Attorney name</p>
                      <p className="text-sm font-medium text-gray-900">
                        {dash(activeCase.attorney_name)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Attorney email</p>
                      <p className="text-sm font-medium text-gray-900">
                        {dash(activeCase.attorney_email)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Attorney phone</p>
                      <p className="text-sm font-medium text-gray-900">
                        {dash(activeCase.attorney_phone)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6">
                    <p className="text-xs text-gray-500">Notes</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-800">
                      {dash(activeCase.notes)}
                    </p>
                  </div>
                </>
              ) : (
                <div className="mt-5 space-y-4">
                  <label className="block text-sm font-medium text-gray-700">
                    Date of Accident
                    <input
                      type="date"
                      value={editDraft.date_of_accident}
                      onChange={(e) =>
                        setEditDraft((d) => ({
                          ...d,
                          date_of_accident: e.target.value,
                        }))
                      }
                      className={`mt-1 h-9 w-full ${DS_INPUT}`}
                    />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block text-sm font-medium text-gray-700">
                      Insurance carrier
                      <input
                        type="text"
                        value={editDraft.insurance_carrier}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            insurance_carrier: e.target.value,
                          }))
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                      Claim number
                      <input
                        type="text"
                        value={editDraft.claim_number}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, claim_number: e.target.value }))
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block text-sm font-medium text-gray-700">
                      Attorney name
                      <input
                        type="text"
                        value={editDraft.attorney_name}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            attorney_name: e.target.value,
                          }))
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className="block text-sm font-medium text-gray-700">
                      Attorney email
                      <input
                        type="email"
                        value={editDraft.attorney_email}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            attorney_email: e.target.value,
                          }))
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className="block text-sm font-medium text-gray-700">
                      Attorney phone
                      <input
                        type="text"
                        value={editDraft.attorney_phone}
                        onChange={(e) =>
                          setEditDraft((d) => ({
                            ...d,
                            attorney_phone: e.target.value,
                          }))
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                  </div>
                  <label className="block text-sm font-medium text-gray-700">
                    Notes
                    <textarea
                      value={editDraft.notes}
                      onChange={(e) =>
                        setEditDraft((d) => ({ ...d, notes: e.target.value }))
                      }
                      rows={3}
                      className={`mt-1 ${DS_INPUT}`}
                    />
                  </label>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-5">
                <label className="text-sm font-medium text-gray-700">
                  Update status
                  <select
                    value={statusDraft}
                    onChange={(e) => setStatusDraft(e.target.value)}
                    className={`ml-2 h-9 ${DS_INPUT} w-auto min-w-[10rem]`}
                  >
                    {PI_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={statusBusy}
                  onClick={() => void updateStatus()}
                  className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
                >
                  {statusBusy ? "Updating…" : "Update Status"}
                </button>
              </div>

              {!editMode ? (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="mt-6 rounded-xl border border-gray-100 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
                >
                  Edit Case
                </button>
              ) : (
                <div className="mt-6 flex gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className={DS_SECONDARY_BTN}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={editBusy}
                    onClick={() => void saveEdit()}
                    className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
                  >
                    {editBusy ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-8 flex items-center justify-between gap-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">
                Referral Milestones
              </h3>
              <button
                type="button"
                onClick={openAddReferral}
                className={`${DS_PRIMARY_BTN} inline-flex shrink-0 items-center justify-center text-sm`}
              >
                + Add Referral
              </button>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-100 bg-white">
                    <tr>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Type
                      </th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Status
                      </th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Referral Date
                      </th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Provider
                      </th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Records Received
                      </th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Follow-up Status
                      </th>
                      <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Notes
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {referralsLoading ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-8 text-center text-gray-500"
                        >
                          Loading referrals…
                        </td>
                      </tr>
                    ) : referrals.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-6 py-8 text-center text-gray-500"
                        >
                          No referral milestones added yet.
                        </td>
                      </tr>
                    ) : (
                      referrals.map((row) => {
                        const st = (row.status ?? "").toLowerCase();
                        const warn = referralNeedsWarning(row);
                        return (
                          <tr key={row.id} className={DS_TR}>
                            <td className={`${DS_TD_PRIMARY} max-w-[14rem]`}>
                              <span className="inline-flex items-center gap-1.5">
                                {warn ? (
                                  <AlertTriangle
                                    className="h-4 w-4 shrink-0 text-red-600"
                                    aria-label="Attention needed"
                                  />
                                ) : null}
                                <span>{referralTypeLabel(row)}</span>
                              </span>
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              <span className={`capitalize ${referralStatusBadgeClass(st)}`}>
                                {st || "—"}
                              </span>
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {formatDisplayDate(row.referral_date ?? undefined)}
                            </td>
                            <td className={`${DS_TD_PRIMARY} max-w-[12rem]`}>
                              <span className="line-clamp-2">
                                {dash(row.provider_specialist)}
                              </span>
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {row.records_received === true ? (
                                <Check
                                  className="h-5 w-5 text-green-600"
                                  aria-label="Yes"
                                />
                              ) : (
                                <X
                                  className="h-5 w-5 text-red-600"
                                  aria-label="No"
                                />
                              )}
                            </td>
                            <td className={`${DS_TD_PRIMARY} max-w-[10rem]`}>
                              <span className="line-clamp-2">
                                {dash(row.follow_up_status)}
                              </span>
                            </td>
                            <td className={`${DS_TD_PRIMARY} max-w-[14rem]`}>
                              <span className="line-clamp-2 whitespace-pre-wrap">
                                {dash(row.notes)}
                              </span>
                            </td>
                            <td className={`${DS_TD_PRIMARY} whitespace-nowrap text-right`}>
                              <button
                                type="button"
                                onClick={() => openEditReferral(row)}
                                className={`${DS_SECONDARY_BTN} mr-2`}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteReferral(row)}
                                className="rounded-xl border border-red-100 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50"
                              >
                                Delete
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

            <h3 className="mt-8 text-xs font-medium uppercase tracking-wider text-gray-500">
              Billing Records
            </h3>
            <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-100 bg-white">
                    <tr>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Date of Service
                      </th>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Billing Type
                      </th>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Total Billed
                      </th>
                      <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {linkedBilling.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-6 py-4 text-center text-gray-500"
                        >
                          No billing records linked to this case
                        </td>
                      </tr>
                    ) : (
                      linkedBilling.map((r) => {
                        const bt = (r.billing_type ?? "cash").toLowerCase();
                        const st = (r.status ?? "draft").toLowerCase();
                        return (
                          <tr key={r.id} className={DS_TR}>
                            <td className={DS_TD_PRIMARY}>
                              {r.date_of_service ?? "—"}
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              <span
                                className={`capitalize ${billingTypePillClass(bt)}`}
                              >
                                {r.billing_type ?? "cash"}
                              </span>
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {formatUsdFromCents(r.total_billed_cents)}
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              <span
                                className={`capitalize ${billingStatusBadgeClass(st)}`}
                              >
                                {r.status ?? "draft"}
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
          </div>
        </div>
      ) : null}

      {addReferralOpen && detailId ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddReferralOpen(false);
          }}
          role="presentation"
        >
          <div
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="pi-ref-add-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="pi-ref-add-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              Add Referral
            </h2>
            <div className="space-y-4 pt-5">
              <label className="block text-sm font-medium text-gray-700">
                Referral Type
                <select
                  value={addRefType}
                  onChange={(e) => setAddRefType(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                >
                  {REFERRAL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {addRefType === "other" ? (
                <label className="block text-sm font-medium text-gray-700">
                  Custom label
                  <input
                    type="text"
                    value={addRefOther}
                    onChange={(e) => setAddRefOther(e.target.value)}
                    placeholder="Describe referral type…"
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
              ) : null}
              <label className="block text-sm font-medium text-gray-700">
                Referral Date (optional)
                <input
                  type="date"
                  value={addRefDate}
                  onChange={(e) => setAddRefDate(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Provider / Specialist (optional)
                <input
                  type="text"
                  value={addRefProvider}
                  onChange={(e) => setAddRefProvider(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
                <textarea
                  value={addRefNotes}
                  onChange={(e) => setAddRefNotes(e.target.value)}
                  rows={3}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => setAddReferralOpen(false)}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addRefBusy}
                onClick={() => void submitAddReferral()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
              >
                {addRefBusy ? "Saving…" : "Add Referral"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editReferralOpen && editingReferral ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditReferralOpen(false);
              setEditingReferral(null);
            }
          }}
          role="presentation"
        >
          <div
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="pi-ref-edit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="pi-ref-edit-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              Edit Referral
            </h2>
            <div className="space-y-4 pt-5">
              <label className="block text-sm font-medium text-gray-700">
                Referral Type
                <select
                  value={editRefType}
                  onChange={(e) => setEditRefType(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                >
                  {REFERRAL_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {editRefType === "other" ? (
                <label className="block text-sm font-medium text-gray-700">
                  Custom label
                  <input
                    type="text"
                    value={editRefOther}
                    onChange={(e) => setEditRefOther(e.target.value)}
                    placeholder="Describe referral type…"
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
              ) : null}
              <label className="block text-sm font-medium text-gray-700">
                Status
                <select
                  value={editRefStatus}
                  onChange={(e) => setEditRefStatus(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                >
                  {REFERRAL_STATUS_EDIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Referral Date (optional)
                <input
                  type="date"
                  value={editRefDate}
                  onChange={(e) => setEditRefDate(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Provider / Specialist (optional)
                <input
                  type="text"
                  value={editRefProvider}
                  onChange={(e) => setEditRefProvider(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={editRefRecordsReceived}
                  onChange={(e) => setEditRefRecordsReceived(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                Records Received
              </label>
              {editRefRecordsReceived ? (
                <label className="block text-sm font-medium text-gray-700">
                  Records Received Date (optional)
                  <input
                    type="date"
                    value={editRefRecordsDate}
                    onChange={(e) => setEditRefRecordsDate(e.target.value)}
                    className={`mt-1 h-9 w-full ${DS_INPUT}`}
                  />
                </label>
              ) : null}
              <label className="block text-sm font-medium text-gray-700">
                Follow-up Status (optional)
                <input
                  type="text"
                  value={editRefFollowUp}
                  onChange={(e) => setEditRefFollowUp(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
                <textarea
                  value={editRefNotes}
                  onChange={(e) => setEditRefNotes(e.target.value)}
                  rows={3}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => {
                  setEditReferralOpen(false);
                  setEditingReferral(null);
                }}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editRefBusy}
                onClick={() => void submitEditReferral()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
              >
                {editRefBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

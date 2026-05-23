"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  claimDaysRemainingClass,
  claimStatusBadgeClass,
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
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";

type PatientRow = {
  id: string;
  first_name?: string;
  last_name?: string;
};

type ClaimRow = {
  id: string;
  clinic_id?: string;
  patient_id: string;
  clinician_id?: string;
  appointment_id?: string;
  first_treatment_date?: string | null;
  payer_name?: string | null;
  payer_id?: string | null;
  policy_number?: string | null;
  member_id?: string | null;
  diagnosis_codes?: string[] | null;
  cpt_codes?: string[] | null;
  total_amount?: number | null;
  filing_deadline?: string | null;
  days_remaining?: number | null;
  status?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AuditLogEntry = {
  id: string;
  claim_id?: string;
  action: string;
  old_status?: string | null;
  new_status?: string | null;
  created_at?: string | null;
};

type ClaimDetail = ClaimRow & {
  audit_log?: AuditLogEntry[];
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function patientDisplayName(p: PatientRow): string {
  const s = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return s || "—";
}

function formatUsd(amount: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount) || 0);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return String(value).slice(0, 10);
}

function formatCodes(codes: string[] | null | undefined): string {
  if (!codes || codes.length === 0) return "—";
  return codes.join(", ");
}

function formatDaysRemaining(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `${days}d`;
}

function formatAuditLabel(entry: AuditLogEntry): string {
  const action = (entry.action ?? "").toLowerCase();
  if (action === "claim_created") return "Claim created";
  if (action === "status_changed") {
    const from = entry.old_status ?? "—";
    const to = entry.new_status ?? "—";
    return `Status changed: ${from} → ${to}`;
  }
  return entry.action || "Event";
}

function formatAuditTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function CodeListField({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  function updateAt(index: number, value: string) {
    const next = [...values];
    next[index] = value;
    onChange(next);
  }

  function addRow() {
    onChange([...values, ""]);
  }

  function removeAt(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <button
          type="button"
          onClick={addRow}
          className="text-xs font-medium text-[var(--color-primary,#16A34A)] hover:underline"
        >
          + Add code
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {values.length === 0 ? (
          <button
            type="button"
            onClick={addRow}
            className={`${DS_SECONDARY_BTN} w-full py-2 text-xs`}
          >
            Add first code
          </button>
        ) : (
          values.map((code, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => updateAt(index, e.target.value)}
                placeholder={placeholder}
                className={`flex-1 ${DS_INPUT}`}
              />
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="shrink-0 rounded-lg px-2 text-sm text-red-600 hover:bg-red-50"
                aria-label="Remove code"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function AdminInsuranceBillingPage() {
  const { clinicId, me } = useClinic();
  const clinicUserId = (me?.clinic_user_id ?? "").trim();

  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerId, setPayerId] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [memberId, setMemberId] = useState("");
  const [firstTreatmentDate, setFirstTreatmentDate] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [cptCodes, setCptCodes] = useState<string[]>([""]);
  const [diagnosisCodes, setDiagnosisCodes] = useState<string[]>([""]);
  const [totalAmount, setTotalAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const patientById = useMemo(() => {
    const m = new Map<string, PatientRow>();
    for (const p of patients) m.set(p.id, p);
    return m;
  }, [patients]);

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    return patients
      .filter((p) => patientDisplayName(p).toLowerCase().includes(q))
      .slice(0, 50);
  }, [patients, patientSearch]);

  const loadPatients = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      const data = res.ok ? await res.json() : [];
      setPatients(Array.isArray(data) ? data : []);
    } catch {
      setPatients([]);
    }
  }, [clinicId]);

  const loadClaims = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/claims?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setError(`Could not load claims (HTTP ${res.status}).`);
        setClaims([]);
        return;
      }
      const data = await res.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load claims");
      setClaims([]);
    }
  }, [clinicId]);

  const loadDetail = useCallback(async (claimId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/claims/${encodeURIComponent(claimId)}`,
        { headers: await authHeaders() },
      );
      if (res.status === 404) {
        setDetailError("Claim not found.");
        setDetail(null);
        return;
      }
      if (!res.ok) {
        setDetailError(`Could not load claim (HTTP ${res.status}).`);
        setDetail(null);
        return;
      }
      setDetail((await res.json()) as ClaimDetail);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load claim");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadClaims();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadClaims]);

  function openCreateModal() {
    setPatientSearch("");
    setSelectedPatientId("");
    setPayerName("");
    setPayerId("");
    setPolicyNumber("");
    setMemberId("");
    setFirstTreatmentDate("");
    setAppointmentId("");
    setCptCodes([""]);
    setDiagnosisCodes([""]);
    setTotalAmount("");
    setNotes("");
    setCreateOpen(true);
  }

  function selectPatient(p: PatientRow) {
    setSelectedPatientId(p.id);
    setPatientSearch(patientDisplayName(p));
  }

  async function submitCreate() {
    if (!selectedPatientId) {
      setError("Select a patient.");
      return;
    }
    if (!clinicUserId) {
      setError("Your clinic user profile is required to file claims. Sign in again or contact support.");
      return;
    }
    if (!firstTreatmentDate) {
      setError("First treatment date is required.");
      return;
    }
    if (!payerName.trim() || !payerId.trim() || !policyNumber.trim() || !memberId.trim()) {
      setError("Payer name, payer ID, policy number, and member ID are required.");
      return;
    }
    const amount = parseFloat(totalAmount);
    if (Number.isNaN(amount) || amount < 0) {
      setError("Enter a valid total amount.");
      return;
    }
    const cpt = cptCodes.map((c) => c.trim()).filter(Boolean);
    const dx = diagnosisCodes.map((c) => c.trim()).filter(Boolean);
    if (!appointmentId.trim()) {
      setError("Appointment ID is required to create a claim.");
      return;
    }

    setCreateBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/billing/claims`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: selectedPatientId,
          clinician_id: clinicUserId,
          appointment_id: appointmentId.trim(),
          first_treatment_date: firstTreatmentDate,
          payer_name: payerName.trim(),
          payer_id: payerId.trim(),
          policy_number: policyNumber.trim(),
          member_id: memberId.trim(),
          diagnosis_codes: dx,
          cpt_codes: cpt,
          total_amount: amount,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setCreateOpen(false);
      await loadClaims();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  function openDetail(claimId: string) {
    setDetailId(claimId);
    void loadDetail(claimId);
  }

  function closeDetail() {
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Billing</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Insurance claims, filing deadlines, and audit history
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className={`${DS_PRIMARY_BTN} inline-flex shrink-0 items-center justify-center`}
        >
          + New Claim
        </button>
      </div>

      {error ? (
        <p className="mt-8 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className={`${DS_TABLE_WRAP} mt-8`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Patient Name</th>
                <th className={DS_TH}>Payer</th>
                <th className={DS_TH}>CPT Codes</th>
                <th className={DS_TH}>Total Amount</th>
                <th className={DS_TH}>First Treatment Date</th>
                <th className={DS_TH}>Filing Deadline</th>
                <th className={DS_TH}>Days Remaining</th>
                <th className={DS_TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : claims.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                    No claims found
                  </td>
                </tr>
              ) : (
                claims.map((c) => {
                  const p = patientById.get(c.patient_id);
                  const name = p ? patientDisplayName(p) : "—";
                  const st = (c.status ?? "draft").toLowerCase();
                  const days = c.days_remaining;
                  return (
                    <tr
                      key={c.id}
                      className={`${DS_TR} cursor-pointer`}
                      onClick={() => openDetail(c.id)}
                    >
                      <td className={DS_TD_PRIMARY}>{name}</td>
                      <td className={DS_TD_PRIMARY}>{c.payer_name ?? "—"}</td>
                      <td className={`max-w-[10rem] truncate ${DS_TD_PRIMARY}`}>
                        {formatCodes(c.cpt_codes)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {formatUsd(c.total_amount)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {formatDate(c.first_treatment_date)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {formatDate(c.filing_deadline)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <span className={claimDaysRemainingClass(days)}>
                          {formatDaysRemaining(days)}
                        </span>
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <span className={`capitalize ${claimStatusBadgeClass(st)}`}>
                          {c.status ?? "draft"}
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

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className={`max-h-[90vh] w-full max-w-lg overflow-y-auto ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="claim-create-title"
          >
            <h2
              id="claim-create-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              New insurance claim
            </h2>
            <div className="space-y-4 pt-5">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Patient
                  <input
                    type="search"
                    value={patientSearch}
                    onChange={(e) => {
                      setPatientSearch(e.target.value);
                      setSelectedPatientId("");
                    }}
                    placeholder="Search by name…"
                    className={`mt-1 h-9 w-full ${DS_INPUT}`}
                  />
                </label>
                {selectedPatientId ? (
                  <p className="mt-1 text-xs text-green-700">Patient selected</p>
                ) : filteredPatients.length > 0 && patientSearch.trim() ? (
                  <ul className="mt-2 max-h-40 overflow-auto rounded-lg border border-gray-100 bg-gray-50">
                    {filteredPatients.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => selectPatient(p)}
                          className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-white"
                        >
                          {patientDisplayName(p)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <label className="block text-sm font-medium text-gray-700">
                Payer name
                <input
                  type="text"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Payer ID
                <input
                  type="text"
                  value={payerId}
                  onChange={(e) => setPayerId(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Policy number
                <input
                  type="text"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Member ID
                <input
                  type="text"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                First treatment date
                <input
                  type="date"
                  value={firstTreatmentDate}
                  onChange={(e) => setFirstTreatmentDate(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Appointment ID
                <input
                  type="text"
                  value={appointmentId}
                  onChange={(e) => setAppointmentId(e.target.value)}
                  placeholder="Linked appointment UUID"
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <CodeListField
                label="CPT codes"
                values={cptCodes}
                onChange={setCptCodes}
                placeholder="e.g. 99213"
              />
              <CodeListField
                label="Diagnosis codes"
                values={diagnosisCodes}
                onChange={setDiagnosisCodes}
                placeholder="e.g. M54.5"
              />
              <label className="block text-sm font-medium text-gray-700">
                Total amount (USD)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
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
                {createBusy ? "Saving…" : "Create claim"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDetail();
          }}
          role="presentation"
        >
          <div
            className={`max-h-[90vh] w-full max-w-3xl overflow-y-auto ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="claim-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <h2
                id="claim-detail-title"
                className="text-lg font-semibold text-gray-900"
              >
                Claim detail
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

            {detailLoading ? (
              <p className="pt-5 text-sm text-gray-500">Loading…</p>
            ) : detail ? (
              <div className="space-y-6 pt-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`capitalize ${claimStatusBadgeClass(
                      (detail.status ?? "draft").toLowerCase(),
                    )}`}
                  >
                    {detail.status ?? "draft"}
                  </span>
                  <span
                    className={`text-sm ${claimDaysRemainingClass(detail.days_remaining)}`}
                  >
                    {formatDaysRemaining(detail.days_remaining)} until filing deadline
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <DetailField
                    label="Patient"
                    value={
                      patientById.get(detail.patient_id)
                        ? patientDisplayName(patientById.get(detail.patient_id)!)
                        : detail.patient_id
                    }
                  />
                  <DetailField label="Payer" value={detail.payer_name} />
                  <DetailField label="Payer ID" value={detail.payer_id} />
                  <DetailField label="Policy number" value={detail.policy_number} />
                  <DetailField label="Member ID" value={detail.member_id} />
                  <DetailField
                    label="First treatment date"
                    value={formatDate(detail.first_treatment_date)}
                  />
                  <DetailField
                    label="Filing deadline"
                    value={formatDate(detail.filing_deadline)}
                  />
                  <DetailField
                    label="Total amount"
                    value={formatUsd(detail.total_amount)}
                  />
                  <DetailField label="CPT codes" value={formatCodes(detail.cpt_codes)} />
                  <DetailField
                    label="Diagnosis codes"
                    value={formatCodes(detail.diagnosis_codes)}
                  />
                  <DetailField label="Appointment ID" value={detail.appointment_id} />
                  <DetailField label="Clinician ID" value={detail.clinician_id} />
                  <DetailField
                    label="Created"
                    value={formatAuditTime(detail.created_at)}
                  />
                  <DetailField
                    label="Updated"
                    value={formatAuditTime(detail.updated_at)}
                  />
                  <div className="sm:col-span-2">
                    <DetailField label="Notes" value={detail.notes?.trim() || "—"} />
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Audit log
                  </h3>
                  {(detail.audit_log ?? []).length === 0 ? (
                    <p className="mt-3 text-sm text-gray-500">No audit events yet.</p>
                  ) : (
                    <ol className="relative mt-4 space-y-0 border-l border-gray-200 pl-6">
                      {(detail.audit_log ?? []).map((entry, index) => (
                        <li key={entry.id ?? index} className="relative pb-6 last:pb-0">
                          <span
                            className="absolute -left-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[var(--color-primary,#16A34A)]"
                            aria-hidden
                          />
                          <p className="text-sm font-medium text-gray-900">
                            {formatAuditLabel(entry)}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {formatAuditTime(entry.created_at)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-gray-900">{value ?? "—"}</p>
    </div>
  );
}

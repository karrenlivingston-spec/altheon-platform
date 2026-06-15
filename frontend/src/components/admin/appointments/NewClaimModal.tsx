"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { InsuranceClaimDetail } from "@/components/admin/billing/billingTypes";
import { WaitlistPatientOption } from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type ClinicianOption = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
};

type AppointmentOption = {
  id: string;
  patient_id: string;
  start_time: string;
  status?: string;
};

export type NewClaimPrefill = {
  patient_id: string;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  clinician_id?: string | null;
  appointment_id: string;
  first_treatment_date: string;
  cpt_codes?: string[];
  total_amount?: number | null;
};

export type NewClaimModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onError?: (message: string) => void;
  existingClaim?: InsuranceClaimDetail | { id: string } | null;
  prefill?: NewClaimPrefill | null;
};

type FieldErrors = {
  patient?: string;
  firstTreatmentDate?: string;
  payerName?: string;
  payerId?: string;
  policyNumber?: string;
  memberId?: string;
  totalAmount?: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function patientLabel(p: WaitlistPatientOption): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown";
}

function clinicianLabel(c: ClinicianOption): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return c.title ? `${n}, ${c.title}` : n || "Provider";
}

function formatApptLabel(a: AppointmentOption): string {
  const d = a.start_time.slice(0, 10);
  const t = a.start_time.length > 11 ? a.start_time.slice(11, 16) : "";
  const status = a.status ? ` (${a.status})` : "";
  return `${d}${t ? ` ${t}` : ""}${status}`;
}

function normalizeCodes(raw: string[] | null | undefined): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return [""];
  return raw;
}

function trimCodes(values: string[]): string[] {
  return values.map((v) => v.trim()).filter(Boolean);
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
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <button
          type="button"
          onClick={() => onChange([...values, ""])}
          className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      <div className="mt-1 space-y-2">
        {values.map((val, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={val}
              onChange={(e) =>
                onChange(values.map((v, j) => (j === i ? e.target.value : v)))
              }
              className={`flex-1 ${DS_INPUT}`}
              placeholder={placeholder}
            />
            {values.length > 1 ? (
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="rounded-lg border border-gray-200 px-2 text-gray-500 hover:bg-gray-50"
                aria-label={`Remove ${label}`}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function NewClaimModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
  existingClaim,
  prefill,
}: NewClaimModalProps) {
  const { clinicId } = useClinic();
  const isEdit = Boolean(existingClaim?.id);

  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<WaitlistPatientOption[]>(
    [],
  );
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] =
    useState<WaitlistPatientOption | null>(null);
  const [clinicianId, setClinicianId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [firstTreatmentDate, setFirstTreatmentDate] = useState("");
  const [payerName, setPayerName] = useState("");
  const [payerId, setPayerId] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [memberId, setMemberId] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [diagnosisCodes, setDiagnosisCodes] = useState<string[]>([""]);
  const [cptCodes, setCptCodes] = useState<string[]>([""]);
  const [notes, setNotes] = useState("");

  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [appointments, setAppointments] = useState<AppointmentOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingClaim, setLoadingClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const searchPatients = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q) return [];
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(q)}`,
        { headers: h },
      );
      const json = res.ok ? await res.json() : [];
      return Array.isArray(json) ? (json as WaitlistPatientOption[]) : [];
    },
    [clinicId],
  );

  const prefillFromClaim = useCallback(
    async (claim: InsuranceClaimDetail) => {
      setFirstTreatmentDate(
        claim.first_treatment_date ? String(claim.first_treatment_date).slice(0, 10) : "",
      );
      setPayerName(claim.payer_name ?? "");
      setPayerId(claim.payer_id ?? "");
      setPolicyNumber(claim.policy_number ?? "");
      setMemberId(claim.member_id ?? "");
      setTotalAmount(
        claim.total_amount != null ? String(claim.total_amount) : "",
      );
      setDiagnosisCodes(normalizeCodes(claim.diagnosis_codes));
      setCptCodes(normalizeCodes(claim.cpt_codes));
      setNotes(claim.notes ?? "");
      setClinicianId(claim.clinician_id ?? "");
      setAppointmentId(claim.appointment_id ?? "");

      if (claim.patient_id) {
        try {
          const h = await authHeaders();
          const res = await fetch(
            `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=`,
            { headers: h },
          );
          const all = res.ok ? await res.json() : [];
          const rows = Array.isArray(all) ? (all as WaitlistPatientOption[]) : [];
          const match =
            rows.find((p) => p.id === claim.patient_id) ??
            ({ id: claim.patient_id } as WaitlistPatientOption);
          setSelectedPatient(match);
          setPatientQuery(patientLabel(match));
        } catch {
          const stub = { id: claim.patient_id } as WaitlistPatientOption;
          setSelectedPatient(stub);
          setPatientQuery(claim.patient_id);
        }
      }
    },
    [clinicId],
  );

  useEffect(() => {
    if (!isOpen) return;
    setPatientQuery("");
    setPatientResults([]);
    setPatientPickerOpen(false);
    setSelectedPatient(null);
    setClinicianId("");
    setAppointmentId("");
    setFirstTreatmentDate("");
    setPayerName("");
    setPayerId("");
    setPolicyNumber("");
    setMemberId("");
    setTotalAmount("");
    setDiagnosisCodes([""]);
    setCptCodes([""]);
    setNotes("");
    setFieldErrors({});
    setSubmitAttempted(false);
    setBusy(false);
    setLoadingClaim(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !existingClaim?.id || !clinicId) return;
    let cancelled = false;

    (async () => {
      setLoadingClaim(true);
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/billing/claims/${encodeURIComponent(existingClaim.id)}`,
          { headers: h },
        );
        if (!res.ok) {
          onError?.("Could not load claim for editing.");
          return;
        }
        const claim = (await res.json()) as InsuranceClaimDetail;
        if (!cancelled) await prefillFromClaim(claim);
      } catch {
        if (!cancelled) onError?.("Could not load claim for editing.");
      } finally {
        if (!cancelled) setLoadingClaim(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, existingClaim?.id, clinicId, prefillFromClaim, onError]);

  useEffect(() => {
    if (!isOpen || !prefill || existingClaim?.id) return;

    const patient: WaitlistPatientOption = {
      id: prefill.patient_id,
      first_name: prefill.patient_first_name ?? null,
      last_name: prefill.patient_last_name ?? null,
    };
    setSelectedPatient(patient);
    setPatientQuery(patientLabel(patient));
    setClinicianId(prefill.clinician_id ?? "");
    setAppointmentId(prefill.appointment_id);
    setFirstTreatmentDate(prefill.first_treatment_date.slice(0, 10));
    if (prefill.cpt_codes?.length) {
      setCptCodes(normalizeCodes(prefill.cpt_codes));
    }
    if (prefill.total_amount != null && prefill.total_amount > 0) {
      setTotalAmount(String(prefill.total_amount));
    }
  }, [isOpen, prefill, existingClaim?.id]);

  useEffect(() => {
    if (!isOpen || !clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setClinicians(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setClinicians([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, clinicId]);

  useEffect(() => {
    if (!isOpen || !clinicId || !selectedPatient?.id) {
      setAppointments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/appointments?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        const data = res.ok ? await res.json() : [];
        const rows = (Array.isArray(data) ? data : []) as AppointmentOption[];
        const filtered = rows
          .filter(
            (a) =>
              a.patient_id === selectedPatient.id &&
              String(a.status ?? "").toLowerCase() !== "cancelled",
          )
          .sort((a, b) => b.start_time.localeCompare(a.start_time))
          .slice(0, 15);
        if (!cancelled) setAppointments(filtered);
      } catch {
        if (!cancelled) setAppointments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, clinicId, selectedPatient?.id]);

  useEffect(() => {
    if (!patientPickerOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [patientPickerOpen]);

  useEffect(() => {
    if (!isOpen || !patientPickerOpen) return;
    const q = patientQuery.trim();
    if (!q) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      (async () => {
        setSearchLoading(true);
        try {
          const rows = await searchPatients(q);
          if (!cancelled) setPatientResults(rows);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOpen, patientPickerOpen, patientQuery, searchPatients]);

  const amountNum = Number(totalAmount);
  const isFormValid =
    Boolean(selectedPatient?.id) &&
    Boolean(firstTreatmentDate.trim()) &&
    Boolean(payerName.trim()) &&
    Boolean(payerId.trim()) &&
    Boolean(policyNumber.trim()) &&
    Boolean(memberId.trim()) &&
    totalAmount.trim() !== "" &&
    !Number.isNaN(amountNum) &&
    amountNum > 0;

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!selectedPatient?.id) errs.patient = "Select a patient.";
    if (!firstTreatmentDate.trim()) errs.firstTreatmentDate = "Required.";
    if (!payerName.trim()) errs.payerName = "Required.";
    if (!payerId.trim()) errs.payerId = "Required.";
    if (!policyNumber.trim()) errs.policyNumber = "Required.";
    if (!memberId.trim()) errs.memberId = "Required.";
    if (!totalAmount.trim() || Number.isNaN(amountNum) || amountNum <= 0) {
      errs.totalAmount = "Enter a valid amount greater than zero.";
    }
    return errs;
  }

  function handleClose() {
    if (busy) return;
    onClose();
  }

  async function handleSubmit() {
    setSubmitAttempted(true);
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      const body = {
        clinic_id: clinicId,
        patient_id: selectedPatient!.id,
        first_treatment_date: firstTreatmentDate.trim(),
        payer_name: payerName.trim(),
        payer_id: payerId.trim(),
        policy_number: policyNumber.trim(),
        member_id: memberId.trim(),
        total_amount: amountNum,
        clinician_id: clinicianId.trim() || null,
        appointment_id: appointmentId.trim() || null,
        diagnosis_codes: trimCodes(diagnosisCodes),
        cpt_codes: trimCodes(cptCodes),
        notes: notes.trim() || null,
      };

      const h = await authHeaders();
      const url = isEdit
        ? `${API_BASE}/billing/claims/${encodeURIComponent(existingClaim!.id)}`
        : `${API_BASE}/billing/claims`;
      const method = isEdit ? "PATCH" : "POST";
      const payload = isEdit
        ? {
            patient_id: body.patient_id,
            first_treatment_date: body.first_treatment_date,
            payer_name: body.payer_name,
            payer_id: body.payer_id,
            policy_number: body.policy_number,
            member_id: body.member_id,
            total_amount: body.total_amount,
            clinician_id: body.clinician_id,
            appointment_id: body.appointment_id,
            diagnosis_codes: body.diagnosis_codes,
            cpt_codes: body.cpt_codes,
            notes: body.notes,
          }
        : body;

      const res = await fetch(url, {
        method,
        headers: h,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}));
        const detail =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        onError?.(detail);
        return;
      }

      onSuccess();
      onClose();
    } catch {
      onError?.("Could not save claim.");
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  const showErr = (key: keyof FieldErrors) =>
    submitAttempted && fieldErrors[key] ? (
      <p className="mt-1 text-xs text-red-600">{fieldErrors[key]}</p>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="new-claim-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="new-claim-title"
          className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
        >
          {isEdit ? "Edit Claim" : "New Claim"}
        </h2>

        {loadingClaim ? (
          <p className="mt-4 text-sm text-gray-500">Loading claim…</p>
        ) : (
          <div className="mt-5 space-y-4">
            <div ref={pickerRef} className="relative">
              <label className="block text-sm font-medium text-gray-700">
                Patient
                <input
                  type="text"
                  value={
                    selectedPatient && !patientPickerOpen
                      ? patientLabel(selectedPatient)
                      : patientQuery
                  }
                  onChange={(e) => {
                    setSelectedPatient(null);
                    setPatientQuery(e.target.value);
                    setPatientPickerOpen(true);
                  }}
                  onFocus={() => setPatientPickerOpen(true)}
                  className={`mt-1 ${DS_INPUT}`}
                  placeholder="Search by name or phone…"
                  required
                />
              </label>
              {showErr("patient")}
              {patientPickerOpen && (patientQuery.trim() || searchLoading) ? (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {searchLoading ? (
                    <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
                  ) : patientResults.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">
                      No patients found
                    </li>
                  ) : (
                    patientResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => {
                            setSelectedPatient(p);
                            setPatientQuery(patientLabel(p));
                            setPatientPickerOpen(false);
                            setAppointmentId("");
                          }}
                        >
                          {patientLabel(p)}
                          {p.phone ? (
                            <span className="ml-2 text-gray-400">{p.phone}</span>
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Clinician
                <select
                  value={clinicianId}
                  onChange={(e) => setClinicianId(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                >
                  <option value="">None</option>
                  {clinicians.map((c) => (
                    <option key={c.id} value={c.id}>
                      {clinicianLabel(c)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedPatient?.id && appointments.length > 0 ? (
                <label className="block text-sm font-medium text-gray-700">
                  Link Appointment
                  <select
                    value={appointmentId}
                    onChange={(e) => setAppointmentId(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  >
                    <option value="">None</option>
                    {appointments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {formatApptLabel(a)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <label className="block text-sm font-medium text-gray-700">
              Date of First Treatment
              <input
                type="date"
                value={firstTreatmentDate}
                onChange={(e) => setFirstTreatmentDate(e.target.value)}
                className={`mt-1 ${DS_INPUT}`}
                required
              />
              {showErr("firstTreatmentDate")}
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Payer Name
                <input
                  type="text"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                  required
                />
                {showErr("payerName")}
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Payer ID
                <input
                  type="text"
                  value={payerId}
                  onChange={(e) => setPayerId(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                  required
                />
                {showErr("payerId")}
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Policy Number
                <input
                  type="text"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                  required
                />
                {showErr("policyNumber")}
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Member ID
                <input
                  type="text"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                  required
                />
                {showErr("memberId")}
              </label>
            </div>

            <label className="block text-sm font-medium text-gray-700">
              Total Amount
              <input
                type="number"
                min="0"
                step="0.01"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className={`mt-1 ${DS_INPUT}`}
                placeholder="0.00"
                required
              />
              {showErr("totalAmount")}
            </label>

            <CodeListField
              label="Diagnosis Codes (ICD)"
              values={diagnosisCodes}
              onChange={setDiagnosisCodes}
              placeholder="e.g. M54.5"
            />

            <CodeListField
              label="CPT Codes"
              values={cptCodes}
              onChange={setCptCodes}
              placeholder="e.g. 97110"
            />

            <label className="block text-sm font-medium text-gray-700">
              Notes
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className={`mt-1 ${DS_INPUT}`}
                placeholder="Optional"
              />
            </label>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className={DS_SECONDARY_BTN}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy || loadingClaim || !isFormValid}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Claim"}
          </button>
        </div>
      </div>
    </div>
  );
}

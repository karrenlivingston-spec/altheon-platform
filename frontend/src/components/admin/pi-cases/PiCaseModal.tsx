"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import CreatePiBillingModal, {
  type PiBillingContext,
} from "@/components/admin/pi-cases/CreatePiBillingModal";
import {
  PiCaseBoardItem,
  PiCaseStatus,
  STATUS_OPTIONS,
} from "@/components/admin/pi-cases/piCasesTypes";

type PatientOption = { id: string; first_name?: string | null; last_name?: string | null };

export type PiCaseFormValues = {
  patient_id: string;
  insurance_carrier: string;
  claim_number: string;
  date_of_accident: string;
  attorney_name: string;
  firm_name: string;
  attorney_phone: string;
  attorney_email: string;
  estimated_settlement: string;
  demand_amount: string;
  settled_amount: string;
  records_requested_date: string;
  records_due_date: string;
  hearing_date: string;
  settlement_date: string;
  status: string;
  case_tags: string[];
  notes: string;
};

type PiCaseModalProps = {
  open: boolean;
  mode: "create" | "edit";
  initial?: PiCaseBoardItem | null;
  defaultStatus?: PiCaseStatus;
  clinicId: string;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (values: PiCaseFormValues) => void;
  searchPatients: (query: string) => Promise<PatientOption[]>;
};

function patientLabel(p: PatientOption): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown";
}

function emptyForm(status = "intake_open"): PiCaseFormValues {
  return {
    patient_id: "",
    insurance_carrier: "",
    claim_number: "",
    date_of_accident: "",
    attorney_name: "",
    firm_name: "",
    attorney_phone: "",
    attorney_email: "",
    estimated_settlement: "",
    demand_amount: "",
    settled_amount: "",
    records_requested_date: "",
    records_due_date: "",
    hearing_date: "",
    settlement_date: "",
    status,
    case_tags: [],
    notes: "",
  };
}

function formFromItem(item: PiCaseBoardItem): PiCaseFormValues {
  const doa = item.date_of_accident;
  let doaIso = "";
  if (doa && doa.includes("/")) {
    const [mo, d, y] = doa.split("/");
    if (y && mo && d) doaIso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return {
    patient_id: item.patient_id ?? "",
    insurance_carrier: item.insurance_carrier ?? "",
    claim_number: item.claim_number ?? "",
    date_of_accident: doaIso,
    attorney_name: item.attorney_name ?? "",
    firm_name: item.firm_name ?? "",
    attorney_phone: item.attorney_phone ?? "",
    attorney_email: item.attorney_email ?? "",
    estimated_settlement: item.estimated_settlement != null ? String(item.estimated_settlement) : "",
    demand_amount: item.demand_amount != null ? String(item.demand_amount) : "",
    settled_amount: item.settled_amount != null ? String(item.settled_amount) : "",
    records_requested_date: (item.records_requested_date ?? "").slice(0, 10),
    records_due_date: (item.records_due_date ?? "").slice(0, 10),
    hearing_date: (item.hearing_date ?? "").slice(0, 10),
    settlement_date: (item.settlement_date ?? "").slice(0, 10),
    status: item.status,
    case_tags: [...(item.case_tags ?? [])],
    notes: item.notes ?? "",
  };
}

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-200 p-2">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = input.trim();
            if (v && !tags.includes(v)) onChange([...tags, v]);
            setInput("");
          }
        }}
        placeholder="Type and press Enter"
        className="min-w-[120px] flex-1 border-0 bg-transparent text-sm outline-none"
      />
    </div>
  );
}

export default function PiCaseModal({
  open,
  mode,
  initial,
  defaultStatus = "intake_open",
  clinicId,
  saving,
  onClose,
  onSubmit,
  searchPatients,
}: PiCaseModalProps) {
  const [form, setForm] = useState<PiCaseFormValues>(emptyForm(defaultStatus));
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [billingModalOpen, setBillingModalOpen] = useState(false);
  const [billingToast, setBillingToast] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setForm(formFromItem(initial));
      setPatientQuery(initial.patient_name);
    } else {
      setForm(emptyForm(defaultStatus));
      setPatientQuery("");
    }
  }, [open, mode, initial, defaultStatus]);

  useEffect(() => {
    if (!open || !pickerOpen) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void searchPatients(patientQuery).then((rows) => {
        if (!cancelled) setPatientResults(rows);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, pickerOpen, patientQuery, searchPatients]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!pickerOpen) return;
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [pickerOpen]);

  useEffect(() => {
    if (!billingToast) return;
    const t = window.setTimeout(() => setBillingToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [billingToast]);

  if (!open) return null;

  const billingContext: PiBillingContext | null =
    mode === "edit" && initial?.id && initial.patient_id
      ? {
          piCaseId: initial.id,
          patientId: initial.patient_id,
          patientName: initial.patient_name,
          insuranceCarrier: initial.insurance_carrier ?? null,
          claimNumber: initial.claim_number ?? null,
          clinicId,
        }
      : null;

  function update<K extends keyof PiCaseFormValues>(key: K, value: PiCaseFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className={`max-h-[92vh] w-full max-w-2xl overflow-y-auto ${DS_CARD}`}>
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === "create" ? "New PI Case" : "Edit PI Case"}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
        >
          {mode === "create" ? (
            <div ref={pickerRef} className="relative">
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Patient</label>
              <input
                value={patientQuery}
                onChange={(e) => {
                  setPatientQuery(e.target.value);
                  setPickerOpen(true);
                }}
                onFocus={() => setPickerOpen(true)}
                className={DS_INPUT}
                placeholder="Search patients…"
                required
              />
              {pickerOpen && patientResults.length > 0 ? (
                <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg border bg-white py-1 shadow-lg">
                  {patientResults.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        onClick={() => {
                          update("patient_id", p.id);
                          setPatientQuery(patientLabel(p));
                          setPickerOpen(false);
                        }}
                      >
                        {patientLabel(p)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm font-medium text-gray-900">{initial?.patient_name}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Insurance Carrier</label>
              <input
                required
                value={form.insurance_carrier}
                onChange={(e) => update("insurance_carrier", e.target.value)}
                className={DS_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Claim Number</label>
              <input value={form.claim_number} onChange={(e) => update("claim_number", e.target.value)} className={DS_INPUT} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Date of Accident</label>
              <input type="date" value={form.date_of_accident} onChange={(e) => update("date_of_accident", e.target.value)} className={DS_INPUT} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Status</label>
              <select value={form.status} onChange={(e) => update("status", e.target.value)} className={DS_INPUT}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <input placeholder="Attorney name" value={form.attorney_name} onChange={(e) => update("attorney_name", e.target.value)} className={DS_INPUT} />
            <input placeholder="Firm name" value={form.firm_name} onChange={(e) => update("firm_name", e.target.value)} className={DS_INPUT} />
            <input placeholder="Phone" value={form.attorney_phone} onChange={(e) => update("attorney_phone", e.target.value)} className={DS_INPUT} />
            <input placeholder="Email" type="email" value={form.attorney_email} onChange={(e) => update("attorney_email", e.target.value)} className={DS_INPUT} />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Est. Settlement ($)</label>
              <input value={form.estimated_settlement} onChange={(e) => update("estimated_settlement", e.target.value)} className={DS_INPUT} />
            </div>
            {mode === "edit" ? (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Demand Amount</label>
                  <input value={form.demand_amount} onChange={(e) => update("demand_amount", e.target.value)} className={DS_INPUT} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Settled Amount</label>
                  <input value={form.settled_amount} onChange={(e) => update("settled_amount", e.target.value)} className={DS_INPUT} />
                </div>
              </>
            ) : null}
          </div>

          {mode === "edit" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <input type="date" value={form.records_requested_date} onChange={(e) => update("records_requested_date", e.target.value)} className={DS_INPUT} placeholder="Records requested" />
              <input type="date" value={form.records_due_date} onChange={(e) => update("records_due_date", e.target.value)} className={DS_INPUT} />
              <input type="date" value={form.hearing_date} onChange={(e) => update("hearing_date", e.target.value)} className={DS_INPUT} />
              <input type="date" value={form.settlement_date} onChange={(e) => update("settlement_date", e.target.value)} className={DS_INPUT} />
            </div>
          ) : null}

          {mode === "edit" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Case Tags</label>
              <TagInput tags={form.case_tags} onChange={(tags) => update("case_tags", tags)} />
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Notes</label>
            <textarea rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} className={DS_INPUT} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={() => setBillingModalOpen(true)}
                disabled={saving || !billingContext}
                className={DS_SECONDARY_BTN}
              >
                Create Billing
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={DS_SECONDARY_BTN}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={DS_PRIMARY_BTN}>
                {saving ? "Saving…" : mode === "create" ? "Create Case" : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>

      {billingToast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[70] max-w-md -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 shadow-lg"
          role="status"
        >
          {billingToast}
        </div>
      ) : null}

      <CreatePiBillingModal
        open={billingModalOpen}
        onClose={() => setBillingModalOpen(false)}
        onSuccess={(message) => setBillingToast(message)}
        context={billingContext}
      />
    </div>
  );
}

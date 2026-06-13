"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  KANBAN_COLUMNS,
  LegalRequest,
  PARTY_TYPE_OPTIONS,
  REQUEST_METHOD_OPTIONS,
  REQUEST_TYPE_OPTIONS,
} from "@/components/admin/legal-requests/legalRequestsTypes";

type PatientOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
};

export type LegalRequestFormValues = {
  patient_id: string;
  patient_name: string;
  request_type: string;
  requesting_party_name: string;
  requesting_party_type: string;
  attorney_name: string;
  firm_name: string;
  attorney_phone: string;
  attorney_email: string;
  request_date: string;
  request_method: string;
  documents_requested: string[];
  documents_prepared: string[];
  send_date: string;
  send_method: string;
  status: string;
  notes: string;
};

type LegalRequestModalProps = {
  open: boolean;
  mode: "create" | "edit";
  initial?: LegalRequest | null;
  clinicId: string;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (values: LegalRequestFormValues) => void;
  searchPatients: (query: string) => Promise<PatientOption[]>;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function patientLabel(p: PatientOption): string {
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown patient";
}

function emptyForm(): LegalRequestFormValues {
  return {
    patient_id: "",
    patient_name: "",
    request_type: "medical_records",
    requesting_party_name: "",
    requesting_party_type: "attorney",
    attorney_name: "",
    firm_name: "",
    attorney_phone: "",
    attorney_email: "",
    request_date: todayIso(),
    request_method: "email",
    documents_requested: [],
    documents_prepared: [],
    send_date: "",
    send_method: "",
    status: "received",
    notes: "",
  };
}

function formFromRequest(req: LegalRequest): LegalRequestFormValues {
  return {
    patient_id: (req.patient_id ?? "").trim(),
    patient_name: (req.patient_name ?? "").trim(),
    request_type: (req.request_type ?? "medical_records").toLowerCase(),
    requesting_party_name: (req.requesting_party_name ?? "").trim(),
    requesting_party_type: (req.requesting_party_type ?? "attorney").toLowerCase(),
    attorney_name: (req.attorney_name ?? "").trim(),
    firm_name: (req.firm_name ?? "").trim(),
    attorney_phone: (req.attorney_phone ?? "").trim(),
    attorney_email: (req.attorney_email ?? "").trim(),
    request_date: (req.request_date ?? todayIso()).slice(0, 10),
    request_method: (req.request_method ?? "email").toLowerCase(),
    documents_requested: [...(req.documents_requested ?? [])],
    documents_prepared: [...(req.documents_prepared ?? [])],
    send_date: (req.send_date ?? "").slice(0, 10),
    send_method: (req.send_method ?? "").trim(),
    status: (req.status ?? "received").toLowerCase(),
    notes: (req.notes ?? "").trim(),
  };
}

function TagInput({
  label,
  tags,
  onChange,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const v = input.trim();
    if (!v || tags.includes(v)) {
      setInput("");
      return;
    }
    onChange([...tags, v]);
    setInput("");
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-200 bg-white p-2">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
          >
            {t}
            <button
              type="button"
              className="text-gray-400 hover:text-gray-700"
              onClick={() => onChange(tags.filter((x) => x !== t))}
              aria-label={`Remove ${t}`}
            >
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
              addTag();
            }
          }}
          placeholder="Type and press Enter"
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      </div>
    </div>
  );
}

export default function LegalRequestModal({
  open,
  mode,
  initial,
  clinicId,
  saving,
  onClose,
  onSubmit,
  searchPatients,
}: LegalRequestModalProps) {
  const [form, setForm] = useState<LegalRequestFormValues>(emptyForm);
  const [attorneyOpen, setAttorneyOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setForm(formFromRequest(initial));
      setPatientQuery(initial.patient_name ?? "");
    } else {
      setForm(emptyForm());
      setPatientQuery("");
    }
    setAttorneyOpen(false);
  }, [open, mode, initial]);

  useEffect(() => {
    if (!open || !patientPickerOpen) return;
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
  }, [open, patientPickerOpen, patientQuery, searchPatients]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!patientPickerOpen) return;
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [patientPickerOpen]);

  if (!open) return null;

  function update<K extends keyof LegalRequestFormValues>(
    key: K,
    value: LegalRequestFormValues[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.patient_name.trim()) return;
    if (!form.requesting_party_name.trim()) return;
    onSubmit(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`max-h-[92vh] w-full max-w-2xl overflow-y-auto ${DS_CARD}`}
        role="dialog"
        aria-modal
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === "create" ? "New Legal Request" : "Edit Legal Request"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div ref={pickerRef} className="relative">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Patient
            </label>
            <input
              value={patientQuery}
              onChange={(e) => {
                setPatientQuery(e.target.value);
                update("patient_name", e.target.value);
                setPatientPickerOpen(true);
              }}
              onFocus={() => setPatientPickerOpen(true)}
              placeholder="Search patients…"
              className={DS_INPUT}
            />
            {patientPickerOpen && patientResults.length > 0 ? (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {patientResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        update("patient_id", p.id);
                        update("patient_name", patientLabel(p));
                        setPatientQuery(patientLabel(p));
                        setPatientPickerOpen(false);
                      }}
                    >
                      {patientLabel(p)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Request Type
              </label>
              <select
                value={form.request_type}
                onChange={(e) => update("request_type", e.target.value)}
                className={DS_INPUT}
              >
                {REQUEST_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Requesting Party Type
              </label>
              <select
                value={form.requesting_party_type}
                onChange={(e) => update("requesting_party_type", e.target.value)}
                className={DS_INPUT}
              >
                {PARTY_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Requesting Party Name
            </label>
            <input
              value={form.requesting_party_name}
              onChange={(e) => update("requesting_party_name", e.target.value)}
              className={DS_INPUT}
              required
            />
          </div>

          <button
            type="button"
            onClick={() => setAttorneyOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {attorneyOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Attorney Details
          </button>

          {attorneyOpen ? (
            <div className="grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 sm:grid-cols-2">
              <input
                value={form.attorney_name}
                onChange={(e) => update("attorney_name", e.target.value)}
                placeholder="Attorney name"
                className={DS_INPUT}
              />
              <input
                value={form.firm_name}
                onChange={(e) => update("firm_name", e.target.value)}
                placeholder="Firm name"
                className={DS_INPUT}
              />
              <input
                value={form.attorney_phone}
                onChange={(e) => update("attorney_phone", e.target.value)}
                placeholder="Phone"
                className={DS_INPUT}
              />
              <input
                value={form.attorney_email}
                onChange={(e) => update("attorney_email", e.target.value)}
                placeholder="Email"
                type="email"
                className={DS_INPUT}
              />
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Request Date
              </label>
              <input
                type="date"
                value={form.request_date}
                onChange={(e) => update("request_date", e.target.value)}
                className={DS_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Request Method
              </label>
              <select
                value={form.request_method}
                onChange={(e) => update("request_method", e.target.value)}
                className={DS_INPUT}
              >
                {REQUEST_METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <TagInput
            label="Documents Requested"
            tags={form.documents_requested}
            onChange={(tags) => update("documents_requested", tags)}
          />

          {mode === "edit" ? (
            <>
              <TagInput
                label="Documents Prepared"
                tags={form.documents_prepared}
                onChange={(tags) => update("documents_prepared", tags)}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Send Date
                  </label>
                  <input
                    type="date"
                    value={form.send_date}
                    onChange={(e) => update("send_date", e.target.value)}
                    className={DS_INPUT}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Send Method
                  </label>
                  <input
                    value={form.send_method}
                    onChange={(e) => update("send_method", e.target.value)}
                    placeholder="Fax, email, mail…"
                    className={DS_INPUT}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) => update("status", e.target.value)}
                  className={DS_INPUT}
                >
                  {KANBAN_COLUMNS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={3}
              className={DS_INPUT}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose} className={DS_SECONDARY_BTN}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className={DS_PRIMARY_BTN}>
              {saving ? "Saving…" : mode === "create" ? "Create Request" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

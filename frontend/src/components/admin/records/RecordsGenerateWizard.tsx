"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ClipboardList,
  CreditCard,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
} from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
} from "@/app/admin/designSystem";
import {
  AttorneyRequest,
  RECORD_TYPE_OPTIONS,
  RecordTypeId,
  defaultDateFrom,
  defaultDateTo,
} from "@/components/admin/records/recordsTypes";
import { apiAuthHeaders } from "@/lib/apiAuth";

type PatientOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  pt_id?: string | null;
};

type RecordsGenerateWizardProps = {
  clinicId: string;
  attorneyRequests: AttorneyRequest[];
  onGenerate: (payload: {
    patient_id: string;
    record_types: string[];
    date_from: string;
    date_to: string;
    recipient_email?: string;
    legal_request_id?: string;
  }) => Promise<void>;
  generating?: boolean;
  successMessage?: string | null;
};

function typeIcon(id: string) {
  switch (id) {
    case "clinical_notes":
      return FileText;
    case "evaluations":
      return ClipboardList;
    case "billing":
      return CreditCard;
    case "imaging":
      return ImageIcon;
    default:
      return FolderOpen;
  }
}

function patientLabel(p: PatientOption): string {
  const name =
    `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown";
  const pt = (p.pt_id ?? "").trim();
  return pt ? `${name} · ${pt}` : name;
}

export default function RecordsGenerateWizard({
  clinicId,
  attorneyRequests,
  onGenerate,
  generating,
  successMessage,
}: RecordsGenerateWizardProps) {
  const [step, setStep] = useState(1);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<PatientOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [selectedTypes, setSelectedTypes] = useState<Set<RecordTypeId>>(
    new Set(["clinical_notes", "evaluations"]),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [legalRequestId, setLegalRequestId] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!search.trim() || !clinicId) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        try {
          const headers = await apiAuthHeaders();
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com"}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(search.trim())}`,
            { headers },
          );
          const json = res.ok ? await res.json() : [];
          if (!cancelled) {
            setSearchResults(Array.isArray(json) ? json : []);
            setShowDropdown(true);
          }
        } catch {
          if (!cancelled) setSearchResults([]);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, clinicId]);

  function toggleType(id: RecordTypeId) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (!selectedPatient || selectedTypes.size === 0) return;
    await onGenerate({
      patient_id: selectedPatient.id,
      record_types: Array.from(selectedTypes),
      date_from: dateFrom,
      date_to: dateTo,
      recipient_email: recipientEmail.trim() || undefined,
      legal_request_id: legalRequestId || undefined,
    });
  }

  const steps = [
    { n: 1, label: "Select Patient" },
    { n: 2, label: "Select Record Types" },
    { n: 3, label: "Review & Generate" },
  ];

  return (
    <div className={DS_CARD}>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Generate Records Packet</h3>
        <p className="text-xs text-gray-500">
          Create a custom packet and export as a merged PDF.
        </p>
      </div>

      <div className="mt-5 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.n} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(s.n)}
              className="flex items-center gap-2 text-left"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  step >= s.n
                    ? "bg-[#16a34a] text-white"
                    : "border border-gray-300 text-gray-400"
                }`}
              >
                {s.n}
              </span>
              <span
                className={`hidden text-xs font-medium sm:inline ${
                  step >= s.n ? "text-gray-900" : "text-gray-400"
                }`}
              >
                {s.label}
              </span>
            </button>
            {i < steps.length - 1 ? (
              <div className="h-px flex-1 bg-gray-200" />
            ) : null}
          </div>
        ))}
      </div>

      {step === 1 ? (
        <div className="mt-6 space-y-4">
          <div ref={searchRef} className="relative">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Search Patient
            </label>
            <input
              type="text"
              className={DS_INPUT}
              placeholder="Search by name or PT-ID…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (selectedPatient) setSelectedPatient(null);
              }}
            />
            {searchLoading ? (
              <Loader2 className="absolute right-3 top-9 h-4 w-4 animate-spin text-gray-400" />
            ) : null}
            {showDropdown && searchResults.length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                {searchResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                      onClick={() => {
                        setSelectedPatient(p);
                        setSearch(patientLabel(p));
                        setShowDropdown(false);
                        setStep(2);
                      }}
                    >
                      {patientLabel(p)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Date From
              </label>
              <input
                type="date"
                className={DS_INPUT}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Date To
              </label>
              <input
                type="date"
                className={DS_INPUT}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="text-sm font-medium text-[#16a34a] hover:underline"
            disabled={!selectedPatient}
            onClick={() => setStep(2)}
          >
            Continue to Record Types →
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {RECORD_TYPE_OPTIONS.map((opt) => {
              const Icon = typeIcon(opt.id);
              const checked = selectedTypes.has(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleType(opt.id)}
                  className={`relative rounded-xl border p-4 text-left transition ${
                    checked
                      ? "border-[#16a34a] bg-green-50/50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  {checked ? (
                    <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#16a34a] text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                  <Icon
                    className={`h-5 w-5 ${checked ? "text-[#16a34a]" : "text-gray-400"}`}
                  />
                  <p className="mt-2 text-sm font-semibold text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.description}</p>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="text-sm font-medium text-[#16a34a] hover:underline"
            onClick={() => setStep(3)}
          >
            Review & Generate →
          </button>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
            <p>
              <span className="font-medium">Patient:</span>{" "}
              {selectedPatient ? patientLabel(selectedPatient) : "—"}
            </p>
            <p className="mt-1">
              <span className="font-medium">Date range:</span> {dateFrom} – {dateTo}
            </p>
            <p className="mt-1">
              <span className="font-medium">Types:</span>{" "}
              {Array.from(selectedTypes)
                .map((t) => RECORD_TYPE_OPTIONS.find((o) => o.id === t)?.label)
                .join(", ") || "—"}
            </p>
          </div>

          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-medium text-gray-700"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            Advanced Options
            <ChevronDown
              className={`h-4 w-4 transition ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>
          {showAdvanced ? (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Recipient Email
                </label>
                <input
                  type="email"
                  className={DS_INPUT}
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="attorney@firm.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Link to Legal Request
                </label>
                <select
                  className={DS_INPUT}
                  value={legalRequestId}
                  onChange={(e) => setLegalRequestId(e.target.value)}
                >
                  <option value="">None</option>
                  {attorneyRequests.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.patient_name} — {r.firm_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className={`${DS_PRIMARY_BTN} w-full`}
            disabled={generating || !selectedPatient || selectedTypes.size === 0}
            onClick={() => void handleGenerate()}
          >
            {generating ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </span>
            ) : (
              "Review & Generate →"
            )}
          </button>
        </div>
      ) : null}

      {successMessage ? (
        <p className="mt-4 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-800">
          {successMessage}
        </p>
      ) : null}
    </div>
  );
}

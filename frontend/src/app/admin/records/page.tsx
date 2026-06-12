"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
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

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type PatientOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  date_of_birth?: string | null;
  email?: string | null;
};

type RecordNote = {
  id: string;
  note_date: string;
  note_type: string;
  clinician_name: string;
  status: string;
};

type ExportResponse = {
  success: boolean;
  email_sent: boolean;
  message: string;
  pdf_base64?: string;
  filename?: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function patientLabel(p: PatientOption): string {
  const name =
    `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "Unknown patient";
  const dob = (p.date_of_birth ?? "").trim();
  return dob ? `${name} · DOB ${dob}` : name;
}

function noteTypeLabel(t: string): string {
  const map: Record<string, string> = {
    initial_evaluation: "Initial Evaluation",
    daily_note: "Daily Note",
    progress_note: "Progress Note",
    discharge_note: "Discharge Note",
  };
  return map[t.toLowerCase()] || t || "—";
}

function formatNoteDate(ymd: string): string {
  if (!ymd) return "—";
  const d = new Date(ymd.includes("T") ? ymd : `${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function defaultStartDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
}

function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminRecordsPage() {
  const { clinic_id: clinicId } = useClinic();

  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<PatientOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(
    null,
  );

  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [notes, setNotes] = useState<RecordNote[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [recipientEmail, setRecipientEmail] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState("records.pdf");

  const searchWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        searchWrapRef.current &&
        !searchWrapRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        try {
          const h = await authHeaders();
          const res = await fetch(
            `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(search.trim())}`,
            { headers: h },
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

  const allSelected =
    notes.length > 0 && notes.every((n) => selectedIds.has(n.id));
  const someSelected = selectedIds.size > 0;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(notes.map((n) => n.id)));
    }
  }, [allSelected, notes]);

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function selectPatient(p: PatientOption) {
    setSelectedPatient(p);
    setSearch(patientLabel(p));
    setShowDropdown(false);
    setRecipientEmail((p.email ?? "").trim());
    setNotes([]);
    setSelectedIds(new Set());
    setFetchError(null);
    setExportMessage(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
  }

  async function fetchNotes() {
    if (!selectedPatient?.id) {
      setFetchError("Select a patient first.");
      return;
    }
    if (!startDate || !endDate) {
      setFetchError("Enter a start and end date.");
      return;
    }
    if (startDate > endDate) {
      setFetchError("Start date must be on or before end date.");
      return;
    }

    setLoadingNotes(true);
    setFetchError(null);
    setNotes([]);
    setSelectedIds(new Set());
    setExportMessage(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }

    try {
      const h = await authHeaders();
      const url =
        `${API_BASE}/api/clinical-notes?patient_id=${encodeURIComponent(selectedPatient.id)}` +
        `&from=${encodeURIComponent(startDate)}` +
        `&to=${encodeURIComponent(endDate)}` +
        `&clinic_id=${encodeURIComponent(clinicId)}`;
      const res = await fetch(url, { headers: h });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          (json as { detail?: string } | null)?.detail ||
          "Failed to load notes";
        throw new Error(detail);
      }
      const rows = Array.isArray(json) ? (json as RecordNote[]) : [];
      setNotes(rows);
      if (rows.length === 0) {
        setFetchError("No signed notes found in this date range.");
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load notes");
    } finally {
      setLoadingNotes(false);
    }
  }

  async function sendRecords() {
    if (!selectedPatient?.id || selectedIds.size === 0) return;
    const email = recipientEmail.trim();
    if (!email) {
      setExportMessage("Enter a recipient email address.");
      return;
    }

    setExporting(true);
    setExportMessage(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }

    try {
      const h = await authHeaders();
      const res = await fetch(`${API_BASE}/api/records/export`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          note_ids: Array.from(selectedIds),
          recipient_email: email,
          clinic_id: clinicId,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ExportResponse & {
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(json.detail || "Export failed");
      }
      setExportMessage(json.message || "Records exported.");

      if (json.pdf_base64) {
        const bytes = Uint8Array.from(atob(json.pdf_base64), (c) =>
          c.charCodeAt(0),
        );
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        setDownloadFilename(json.filename || "records.pdf");
      }
    } catch (e) {
      setExportMessage(
        e instanceof Error ? e.message : "Failed to export records",
      );
    } finally {
      setExporting(false);
    }
  }

  const selectedCount = selectedIds.size;

  const exportSectionVisible = useMemo(() => someSelected, [someSelected]);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-8">
        <h1 className={DS_PAGE_TITLE}>Records</h1>
        <p className={DS_PAGE_SUBTITLE}>
          Search signed clinical notes and send merged PDF records to a patient
          or third party.
        </p>
      </div>

      <div className={`${DS_CARD} mb-6 space-y-4`}>
        <div ref={searchWrapRef} className="relative">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Patient
          </label>
          <input
            type="text"
            className={DS_INPUT}
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (selectedPatient) setSelectedPatient(null);
            }}
            onFocus={() => {
              if (searchResults.length > 0) setShowDropdown(true);
            }}
          />
          {searchLoading ? (
            <Loader2 className="absolute right-3 top-9 h-4 w-4 animate-spin text-gray-400" />
          ) : null}
          {showDropdown && searchResults.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {searchResults.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50"
                    onClick={() => selectPatient(p)}
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Start Date
            </label>
            <input
              type="date"
              className={DS_INPUT}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              End Date
            </label>
            <input
              type="date"
              className={DS_INPUT}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <button
          type="button"
          className={DS_PRIMARY_BTN}
          disabled={loadingNotes || !selectedPatient}
          onClick={() => void fetchNotes()}
        >
          {loadingNotes ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching…
            </span>
          ) : (
            "Fetch Notes"
          )}
        </button>

        {fetchError ? (
          <p className="text-sm text-red-600">{fetchError}</p>
        ) : null}
      </div>

      {notes.length > 0 ? (
        <div className={DS_TABLE_WRAP}>
          <table className="min-w-full">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={`${DS_TH} w-12`}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={allSelected ? "Deselect all" : "Select all"}
                  />
                </th>
                <th className={DS_TH}>Date</th>
                <th className={DS_TH}>Note Type</th>
                <th className={DS_TH}>Clinician</th>
                <th className={DS_TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {notes.map((n) => (
                <tr key={n.id} className={DS_TR}>
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(n.id)}
                      onChange={() => toggleOne(n.id)}
                      aria-label={`Select note ${n.id}`}
                    />
                  </td>
                  <td className={DS_TD_PRIMARY}>{formatNoteDate(n.note_date)}</td>
                  <td className={DS_TD_PRIMARY}>{noteTypeLabel(n.note_type)}</td>
                  <td className={DS_TD_PRIMARY}>{n.clinician_name}</td>
                  <td className={DS_TD_PRIMARY}>
                    <span className="inline-flex rounded-full bg-emerald-900/90 px-2.5 py-0.5 text-xs font-medium text-emerald-50">
                      Signed
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 px-6 py-3 text-xs text-gray-500">
            {allSelected ? (
              <button
                type="button"
                className="text-[#16A34A] hover:underline"
                onClick={() => setSelectedIds(new Set())}
              >
                Deselect All
              </button>
            ) : (
              <button
                type="button"
                className="text-[#16A34A] hover:underline"
                onClick={() => setSelectedIds(new Set(notes.map((n) => n.id)))}
              >
                Select All
              </button>
            )}
            {selectedCount > 0 ? (
              <span className="ml-3">{selectedCount} selected</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {exportSectionVisible ? (
        <div className={`${DS_CARD} mt-6 space-y-4`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
            Export Records
          </h2>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Recipient Email
            </label>
            <input
              type="email"
              className={DS_INPUT}
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="patient@example.com"
            />
          </div>
          <button
            type="button"
            className={DS_PRIMARY_BTN}
            disabled={exporting || selectedCount === 0}
            onClick={() => void sendRecords()}
          >
            {exporting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </span>
            ) : (
              "Send Records"
            )}
          </button>
          <p className="text-xs text-gray-500">
            Selected notes will be merged into a single PDF and sent to the
            email address above.
          </p>
          {exportMessage ? (
            <p className="text-sm text-gray-700">{exportMessage}</p>
          ) : null}
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={downloadFilename}
              className={DS_SECONDARY_BTN}
            >
              Download PDF
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

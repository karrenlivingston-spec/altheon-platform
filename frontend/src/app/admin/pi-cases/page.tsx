"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";
const BRAND = "#1F7A47";

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

function piStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "open") return "bg-blue-50 text-blue-700";
  if (s === "in_treatment") return "bg-amber-50 text-amber-800";
  if (s === "pending_settlement") return "bg-orange-50 text-orange-800";
  if (s === "settled") return "bg-emerald-50 text-emerald-700";
  if (s === "closed") return "bg-gray-100 text-gray-600";
  return "bg-gray-100 text-gray-700";
}

function billingTypeBadgeClass(t: string): string {
  const s = t.toLowerCase();
  if (s === "cash") return "bg-emerald-50 text-emerald-700";
  if (s === "insurance") return "bg-blue-50 text-blue-700";
  if (s === "mixed") return "bg-violet-50 text-violet-700";
  return "bg-gray-100 text-gray-700";
}

function billingRecordStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "draft") return "bg-gray-100 text-gray-700";
  if (s === "submitted") return "bg-amber-50 text-amber-800";
  if (s === "paid") return "bg-emerald-50 text-emerald-700";
  if (s === "denied") return "bg-red-50 text-red-700";
  if (s === "partial") return "bg-orange-50 text-orange-800";
  return "bg-gray-100 text-gray-700";
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

export default function AdminPiCasesPage() {
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
        fetch(`${API_BASE}/pi-cases?clinic_id=${encodeURIComponent(CLINIC_ID)}`),
        fetch(`${API_BASE}/patients?clinic_id=${encodeURIComponent(CLINIC_ID)}`),
        fetch(`${API_BASE}/billing-records?clinic_id=${encodeURIComponent(CLINIC_ID)}`),
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
        clinic_id: CLINIC_ID,
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
    <div className="w-full">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-semibold text-gray-900">PI Cases</h1>
          <p className="text-sm tracking-wide text-gray-500">
            Personal injury case management
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
        >
          + New PI Case
        </button>
      </div>

      {error ? (
        <p className="mb-6 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-2xl border border-gray-100 bg-white px-6 py-4 shadow-sm">
        <label className="block text-sm font-medium text-gray-700">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 block h-9 w-52 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
            className="mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </label>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
        >
          Clear filters
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Patient Name
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Insurance Carrier
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Claim Number
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Attorney
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date of Accident
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
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
                    <tr
                      key={c.id}
                      className="transition-colors hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 text-gray-800">{name}</td>
                      <td className="px-6 py-4 text-gray-800">
                        {dash(c.insurance_carrier)}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-gray-800">
                        {dash(c.claim_number)}
                      </td>
                      <td className="px-6 py-4 text-gray-800">
                        {dash(c.attorney_name)}
                      </td>
                      <td className="px-6 py-4 text-gray-800">
                        {formatAccidentDate(c.date_of_accident ?? undefined)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${piStatusBadgeClass(st)}`}
                        >
                          {st.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => openDetail(c)}
                          className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
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
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-xl"
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
                  className="mt-1 h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                  className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Insurance Carrier (optional)
                <input
                  type="text"
                  value={cInsurance}
                  onChange={(e) => setCInsurance(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Claim Number (optional)
                <input
                  type="text"
                  value={cClaim}
                  onChange={(e) => setCClaim(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Attorney Name (optional)
                <input
                  type="text"
                  value={cAttorneyName}
                  onChange={(e) => setCAttorneyName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Attorney Email (optional)
                <input
                  type="email"
                  value={cAttorneyEmail}
                  onChange={(e) => setCAttorneyEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Attorney Phone (optional)
                <input
                  type="text"
                  value={cAttorneyPhone}
                  onChange={(e) => setCAttorneyPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
                <textarea
                  value={cNotes}
                  onChange={(e) => setCNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createBusy}
                onClick={() => void submitCreate()}
                className="rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-xl"
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
                className="rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-50"
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

            <div className="mt-5 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
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
                      className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                    className="ml-2 h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                  className="rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {statusBusy ? "Updating…" : "Update Status"}
                </button>
              </div>

              {!editMode ? (
                <button
                  type="button"
                  onClick={() => setEditMode(true)}
                  className="mt-6 rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
                >
                  Edit Case
                </button>
              ) : (
                <div className="mt-6 flex gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={editBusy}
                    onClick={() => void saveEdit()}
                    className="rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {editBusy ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>

            <h3 className="mt-8 text-xs font-medium uppercase tracking-wider text-gray-500">
              Billing Records
            </h3>
            <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50">
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
                          <tr
                            key={r.id}
                            className="transition-colors hover:bg-gray-50"
                          >
                            <td className="px-6 py-4 text-gray-800">
                              {r.date_of_service ?? "—"}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${billingTypeBadgeClass(bt)}`}
                              >
                                {r.billing_type ?? "cash"}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-gray-800">
                              {formatUsdFromCents(r.total_billed_cents)}
                            </td>
                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${billingRecordStatusBadgeClass(st)}`}
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
    </div>
  );
}

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

type BillingRecordRow = {
  id: string;
  clinic_id?: string;
  patient_id: string;
  date_of_service?: string;
  billing_type?: string;
  status?: string;
  total_billed_cents?: number | null;
  total_paid_cents?: number | null;
};

type BillingLineItem = {
  id: string;
  billing_record_id?: string;
  cpt_code?: string;
  description?: string | null;
  units?: number;
  rate_cents?: number;
  total_cents?: number;
  payment_type?: string;
  modifiers?: string[] | null;
  is_timed?: boolean;
};

type BillingRecordDetail = BillingRecordRow & {
  line_items?: BillingLineItem[];
};

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "paid", label: "Paid" },
  { value: "denied", label: "Denied" },
  { value: "partial", label: "Partial" },
] as const;

const RECORD_STATUS_OPTIONS = [
  "draft",
  "submitted",
  "paid",
  "denied",
  "partial",
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

function billingTypeBadgeClass(t: string): string {
  const s = t.toLowerCase();
  if (s === "cash") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200";
  if (s === "insurance") return "bg-blue-100 text-blue-900 ring-1 ring-blue-200";
  if (s === "mixed") return "bg-violet-100 text-violet-900 ring-1 ring-violet-200";
  return "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200";
}

function recordStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "draft") return "bg-neutral-200 text-neutral-800 ring-1 ring-neutral-300";
  if (s === "submitted") return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  if (s === "paid") return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200";
  if (s === "denied") return "bg-red-100 text-red-900 ring-1 ring-red-200";
  if (s === "partial") return "bg-orange-100 text-orange-900 ring-1 ring-orange-200";
  return "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200";
}

function compareDateOfServiceDesc(a: BillingRecordRow, b: BillingRecordRow): number {
  const da = a.date_of_service ?? "";
  const db = b.date_of_service ?? "";
  return db.localeCompare(da);
}

export default function AdminBillingPage() {
  const [records, setRecords] = useState<BillingRecordRow[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchName, setSearchName] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createPatientId, setCreatePatientId] = useState("");
  const [createDateOfService, setCreateDateOfService] = useState("");
  const [createBillingType, setCreateBillingType] = useState("cash");
  const [createAppointmentId, setCreateAppointmentId] = useState("");
  const [createPiCaseId, setCreatePiCaseId] = useState("");
  const [createProviderId, setCreateProviderId] = useState("");
  const [createInsurance, setCreateInsurance] = useState("");
  const [createClaimNumber, setCreateClaimNumber] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BillingRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const [lineFormOpen, setLineFormOpen] = useState(false);
  const [lineCpt, setLineCpt] = useState("");
  const [lineDescription, setLineDescription] = useState("");
  const [lineUnits, setLineUnits] = useState("1");
  const [lineRateDollars, setLineRateDollars] = useState("");
  const [lineTimed, setLineTimed] = useState(false);
  const [linePaymentType, setLinePaymentType] = useState<"cash" | "insurance">(
    "cash",
  );
  const [lineModifiers, setLineModifiers] = useState("");
  const [lineBusy, setLineBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);

  const patientById = useMemo(() => {
    const m = new Map<string, PatientRow>();
    for (const p of patients) m.set(p.id, p);
    return m;
  }, [patients]);

  const loadPatients = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
      );
      const data = res.ok ? await res.json() : [];
      setPatients(Array.isArray(data) ? data : []);
    } catch {
      setPatients([]);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ clinic_id: CLINIC_ID });
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await fetch(`${API_BASE}/billing-records?${params.toString()}`);
      if (!res.ok) {
        setError(`Could not load billing records (HTTP ${res.status}).`);
        setRecords([]);
        return;
      }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      list.sort(compareDateOfServiceDesc);
      setRecords(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing records");
      setRecords([]);
    }
  }, [statusFilter, dateFrom, dateTo]);

  const loadDetail = useCallback(async (recordId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing-records/${encodeURIComponent(recordId)}`,
      );
      if (res.status === 404) {
        setDetailError("Billing record not found.");
        setDetail(null);
        return;
      }
      if (!res.ok) {
        setDetailError(`Could not load record (HTTP ${res.status}).`);
        setDetail(null);
        return;
      }
      const data = (await res.json()) as BillingRecordDetail;
      setDetail(data);
      setStatusDraft((data.status ?? "draft").toLowerCase());
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : "Failed to load billing record",
      );
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
      await loadRecords();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRecords]);

  const tableRows = useMemo(() => {
    const q = searchName.trim().toLowerCase();
    return records.filter((r) => {
      if (!q) return true;
      const p = patientById.get(r.patient_id);
      const name = p ? patientDisplayName(p).toLowerCase() : "";
      return name.includes(q);
    });
  }, [records, searchName, patientById]);

  function openCreateModal() {
    setCreatePatientId("");
    setCreateDateOfService("");
    setCreateBillingType("cash");
    setCreateAppointmentId("");
    setCreatePiCaseId("");
    setCreateProviderId("");
    setCreateInsurance("");
    setCreateClaimNumber("");
    setCreateNotes("");
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (!createPatientId || !createDateOfService) {
      setError("Select a patient and date of service.");
      return;
    }
    setCreateBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        clinic_id: CLINIC_ID,
        patient_id: createPatientId,
        date_of_service: createDateOfService,
        billing_type: createBillingType,
      };
      if (createAppointmentId.trim())
        body.appointment_id = createAppointmentId.trim();
      if (createPiCaseId.trim()) body.pi_case_id = createPiCaseId.trim();
      if (createProviderId.trim()) body.provider_id = createProviderId.trim();
      if (createInsurance.trim()) body.insurance_carrier = createInsurance.trim();
      if (createClaimNumber.trim()) body.claim_number = createClaimNumber.trim();
      if (createNotes.trim()) body.notes = createNotes.trim();

      const res = await fetch(`${API_BASE}/billing-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      setCreateOpen(false);
      await loadRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreateBusy(false);
    }
  }

  function clearFilters() {
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setSearchName("");
  }

  async function openDetail(recordId: string) {
    setDetailId(recordId);
    setLineFormOpen(false);
    await loadDetail(recordId);
  }

  function closeDetail() {
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
    setLineFormOpen(false);
  }

  async function refreshListAndDetail() {
    await loadRecords();
    if (detailId) await loadDetail(detailId);
  }

  async function updateRecordStatus() {
    if (!detailId || !statusDraft) return;
    setStatusBusy(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing-records/${encodeURIComponent(detailId)}/status`,
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
      await refreshListAndDetail();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setStatusBusy(false);
    }
  }

  async function deleteLineItem(itemId: string) {
    if (!detailId) return;
    setDeleteBusyId(itemId);
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing-line-items/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setDetailError(await res.text().catch(() => res.statusText));
        return;
      }
      await refreshListAndDetail();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleteBusyId(null);
    }
  }

  async function submitLineItem() {
    if (!detailId) return;
    const cpt = lineCpt.trim();
    if (!cpt) {
      setDetailError("CPT code is required.");
      return;
    }
    const units = parseInt(lineUnits, 10);
    if (Number.isNaN(units) || units < 1) {
      setDetailError("Units must be a positive integer.");
      return;
    }
    const rateDollars = parseFloat(lineRateDollars);
    if (Number.isNaN(rateDollars) || rateDollars < 0) {
      setDetailError("Enter a valid rate (USD).");
      return;
    }
    const rate_cents = Math.round(rateDollars * 100);
    const modifiers = lineModifiers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setLineBusy(true);
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing-records/${encodeURIComponent(detailId)}/line-items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cpt_code: cpt,
            description: lineDescription.trim() || null,
            units,
            rate_cents,
            is_timed: lineTimed,
            payment_type: linePaymentType,
            modifiers,
          }),
        },
      );
      if (!res.ok) {
        setDetailError(await res.text().catch(() => res.statusText));
        return;
      }
      setLineFormOpen(false);
      setLineCpt("");
      setLineDescription("");
      setLineUnits("1");
      setLineRateDollars("");
      setLineTimed(false);
      setLinePaymentType("cash");
      setLineModifiers("");
      await refreshListAndDetail();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Add line item failed");
    } finally {
      setLineBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Billing</h1>
          <p className="mt-1 text-sm text-neutral-600">
            CPT billing records and line items
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex shrink-0 items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
          style={{ backgroundColor: BRAND }}
        >
          + New Billing Record
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-neutral-200 bg-neutral-50/80 p-4">
        <label className="block text-sm font-medium text-neutral-700">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 block w-40 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          >
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-neutral-700">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 block rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-700">
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 block rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
          />
        </label>
        <label className="block min-w-[12rem] flex-1 text-sm font-medium text-neutral-700">
          Search patient
          <input
            type="search"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="Filter by name…"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none ring-[#2D5E3F] focus:ring-2"
          />
        </label>
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Clear filters
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="px-4 py-3 font-medium text-neutral-700">
                  Date of Service
                </th>
                <th className="px-4 py-3 font-medium text-neutral-700">
                  Patient Name
                </th>
                <th className="px-4 py-3 font-medium text-neutral-700">
                  Billing Type
                </th>
                <th className="px-4 py-3 font-medium text-neutral-700">Total Billed</th>
                <th className="px-4 py-3 font-medium text-neutral-700">Total Paid</th>
                <th className="px-4 py-3 font-medium text-neutral-700">Status</th>
                <th className="px-4 py-3 font-medium text-neutral-700 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                    Loading…
                  </td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                    No billing records found
                  </td>
                </tr>
              ) : (
                tableRows.map((r) => {
                  const p = patientById.get(r.patient_id);
                  const name = p ? patientDisplayName(p) : "—";
                  const bt = (r.billing_type ?? "cash").toLowerCase();
                  const st = (r.status ?? "draft").toLowerCase();
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50/80">
                      <td className="px-4 py-3 text-neutral-800">
                        {r.date_of_service ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-800">{name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${billingTypeBadgeClass(bt)}`}
                        >
                          {r.billing_type ?? "cash"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-800">
                        {formatUsdFromCents(r.total_billed_cents)}
                      </td>
                      <td className="px-4 py-3 text-neutral-800">
                        {formatUsdFromCents(r.total_paid_cents)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${recordStatusBadgeClass(st)}`}
                        >
                          {r.status ?? "draft"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void openDetail(r.id)}
                          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
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
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-200 bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal
            aria-labelledby="billing-create-title"
          >
            <h2
              id="billing-create-title"
              className="text-lg font-semibold text-neutral-900"
            >
              New billing record
            </h2>
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-neutral-700">
                Patient
                <select
                  value={createPatientId}
                  onChange={(e) => setCreatePatientId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select patient…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {patientDisplayName(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Date of service
                <input
                  type="date"
                  value={createDateOfService}
                  onChange={(e) => setCreateDateOfService(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Billing type
                <select
                  value={createBillingType}
                  onChange={(e) => setCreateBillingType(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="cash">Cash</option>
                  <option value="insurance">Insurance</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Appointment ID (optional)
                <input
                  type="text"
                  value={createAppointmentId}
                  onChange={(e) => setCreateAppointmentId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                PI case ID (optional)
                <input
                  type="text"
                  value={createPiCaseId}
                  onChange={(e) => setCreatePiCaseId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Provider ID (optional)
                <input
                  type="text"
                  value={createProviderId}
                  onChange={(e) => setCreateProviderId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Insurance carrier (optional)
                <input
                  type="text"
                  value={createInsurance}
                  onChange={(e) => setCreateInsurance(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Claim number (optional)
                <input
                  type="text"
                  value={createClaimNumber}
                  onChange={(e) => setCreateClaimNumber(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Notes (optional)
                <textarea
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createBusy}
                onClick={() => void submitCreate()}
                className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: BRAND }}
              >
                {createBusy ? "Saving…" : "Create"}
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
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-neutral-200 bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal
            aria-labelledby="billing-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                id="billing-detail-title"
                className="text-lg font-semibold text-neutral-900"
              >
                Billing record
              </h2>
              <button
                type="button"
                onClick={closeDetail}
                className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {detailError ? (
              <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {detailError}
              </p>
            ) : null}

            {detailLoading ? (
              <p className="mt-6 text-sm text-neutral-500">Loading…</p>
            ) : detail ? (
              <>
                <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <p className="text-xs font-medium uppercase text-neutral-500">
                        Patient
                      </p>
                      <p className="text-sm font-semibold text-neutral-900">
                        {patientDisplayName(
                          patientById.get(detail.patient_id) ?? {
                            id: detail.patient_id,
                            first_name: "",
                            last_name: "",
                          },
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase text-neutral-500">
                        Date of service
                      </p>
                      <p className="text-sm font-semibold text-neutral-900">
                        {detail.date_of_service ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase text-neutral-500">
                        Billing type
                      </p>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${billingTypeBadgeClass(
                          (detail.billing_type ?? "cash").toLowerCase(),
                        )}`}
                      >
                        {detail.billing_type ?? "cash"}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase text-neutral-500">
                        Status
                      </p>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${recordStatusBadgeClass(
                          (detail.status ?? "draft").toLowerCase(),
                        )}`}
                      >
                        {detail.status ?? "draft"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-8">
                    <div>
                      <p className="text-xs text-neutral-500">Total billed</p>
                      <p className="text-lg font-semibold text-neutral-900">
                        {formatUsdFromCents(detail.total_billed_cents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500">Total paid</p>
                      <p className="text-lg font-semibold text-neutral-900">
                        {formatUsdFromCents(detail.total_paid_cents)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-end gap-3">
                    <label className="text-sm font-medium text-neutral-700">
                      Update status
                      <select
                        value={statusDraft}
                        onChange={(e) => setStatusDraft(e.target.value)}
                        className="ml-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                      >
                        {RECORD_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={statusBusy}
                      onClick={() => void updateRecordStatus()}
                      className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      style={{ backgroundColor: BRAND }}
                    >
                      {statusBusy ? "Updating…" : "Update Status"}
                    </button>
                  </div>
                </div>

                <h3 className="mt-6 text-sm font-semibold text-neutral-900">
                  Line items
                </h3>
                <div className="mt-2 overflow-hidden rounded-lg border border-neutral-200">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-neutral-200 bg-neutral-50">
                        <tr>
                          <th className="px-3 py-2 font-medium text-neutral-700">
                            CPT
                          </th>
                          <th className="px-3 py-2 font-medium text-neutral-700">
                            Description
                          </th>
                          <th className="px-3 py-2 font-medium text-neutral-700">
                            Units
                          </th>
                          <th className="px-3 py-2 font-medium text-neutral-700">Rate</th>
                          <th className="px-3 py-2 font-medium text-neutral-700">
                            Total
                          </th>
                          <th className="px-3 py-2 font-medium text-neutral-700">
                            Payment
                          </th>
                          <th className="px-3 py-2 font-medium text-neutral-700">
                            Modifiers
                          </th>
                          <th className="px-3 py-2 text-right font-medium text-neutral-700">
                            Delete
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {(detail.line_items ?? []).length === 0 ? (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-3 py-4 text-center text-neutral-500"
                            >
                              No line items
                            </td>
                          </tr>
                        ) : (
                          (detail.line_items ?? []).map((li) => {
                            const mods = li.modifiers;
                            const modStr =
                              Array.isArray(mods) && mods.length > 0
                                ? mods.join(", ")
                                : "—";
                            return (
                              <tr key={li.id}>
                                <td className="px-3 py-2 font-mono text-xs">
                                  {li.cpt_code ?? "—"}
                                </td>
                                <td className="max-w-[10rem] truncate px-3 py-2 text-neutral-800">
                                  {li.description ?? "—"}
                                </td>
                                <td className="px-3 py-2">{li.units ?? "—"}</td>
                                <td className="px-3 py-2">
                                  {formatUsdFromCents(li.rate_cents)}
                                </td>
                                <td className="px-3 py-2 font-medium">
                                  {formatUsdFromCents(li.total_cents)}
                                </td>
                                <td className="px-3 py-2 capitalize">
                                  {li.payment_type ?? "—"}
                                </td>
                                <td className="px-3 py-2 text-xs text-neutral-600">
                                  {modStr}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    disabled={deleteBusyId === li.id}
                                    onClick={() => void deleteLineItem(li.id)}
                                    className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    {deleteBusyId === li.id ? "…" : "Delete"}
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

                {!lineFormOpen ? (
                  <button
                    type="button"
                    onClick={() => setLineFormOpen(true)}
                    className="mt-4 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                  >
                    Add Line Item
                  </button>
                ) : (
                  <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
                    <p className="text-sm font-semibold text-neutral-900">
                      New line item
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-neutral-700">
                        CPT code
                        <input
                          type="text"
                          value={lineCpt}
                          onChange={(e) => setLineCpt(e.target.value)}
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-sm font-medium text-neutral-700">
                        Description
                        <input
                          type="text"
                          value={lineDescription}
                          onChange={(e) => setLineDescription(e.target.value)}
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-sm font-medium text-neutral-700">
                        Units
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={lineUnits}
                          onChange={(e) => setLineUnits(e.target.value)}
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-sm font-medium text-neutral-700">
                        Rate (USD)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={lineRateDollars}
                          onChange={(e) => setLineRateDollars(e.target.value)}
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                        <input
                          type="checkbox"
                          checked={lineTimed}
                          onChange={(e) => setLineTimed(e.target.checked)}
                          className="h-4 w-4 rounded border-neutral-300"
                          style={{ accentColor: BRAND }}
                        />
                        Is timed
                      </label>
                      <label className="block text-sm font-medium text-neutral-700">
                        Payment type
                        <select
                          value={linePaymentType}
                          onChange={(e) =>
                            setLinePaymentType(
                              e.target.value as "cash" | "insurance",
                            )
                          }
                          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="cash">Cash</option>
                          <option value="insurance">Insurance</option>
                        </select>
                      </label>
                      <label className="block text-sm font-medium text-neutral-700 sm:col-span-2">
                        Modifiers (comma-separated)
                        <input
                          type="text"
                          value={lineModifiers}
                          onChange={(e) => setLineModifiers(e.target.value)}
                          placeholder="e.g. 59, LT"
                          className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setLineFormOpen(false)}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={lineBusy}
                        onClick={() => void submitLineItem()}
                        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: BRAND }}
                      >
                        {lineBusy ? "Saving…" : "Submit"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

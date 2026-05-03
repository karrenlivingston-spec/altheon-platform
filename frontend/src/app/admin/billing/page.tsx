"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

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
} from "@/app/admin/designSystem";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";

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
  amount_paid_cents?: number | null;
  amount_remaining_cents?: number | null;
};

type BillingPaymentRow = {
  id: string;
  billing_record_id?: string;
  amount_cents: number;
  payment_date?: string;
  payment_method?: string | null;
  note?: string | null;
  created_at?: string;
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

function amountPaidCents(r: BillingRecordRow): number {
  const a = r.amount_paid_cents;
  if (a !== undefined && a !== null) return Number(a) || 0;
  return Number(r.total_paid_cents) || 0;
}

function paymentProgressPct(r: BillingRecordRow): number {
  const billed = Number(r.total_billed_cents) || 0;
  const paid = amountPaidCents(r);
  if (billed <= 0) return 0;
  return Math.min(100, Math.round((paid / billed) * 100));
}

function showRecordPaymentButton(r: BillingRecordRow): boolean {
  const st = (r.status ?? "").toLowerCase();
  if (st === "denied") return false;
  const billed = Number(r.total_billed_cents) || 0;
  const paid = amountPaidCents(r);
  return billed > 0 && paid < billed;
}

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "insurance", label: "Insurance" },
  { value: "attorney", label: "Attorney" },
  { value: "other", label: "Other" },
] as const;

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

  const [paymentsByRecord, setPaymentsByRecord] = useState<
    Record<string, BillingPaymentRow[]>
  >({});
  const [detailPayments, setDetailPayments] = useState<BillingPaymentRow[]>([]);

  const [paymentModalRecordId, setPaymentModalRecordId] = useState<string | null>(
    null,
  );
  const [paymentAmountDollars, setPaymentAmountDollars] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentBusy, setPaymentBusy] = useState(false);

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
        setPaymentsByRecord({});
        return;
      }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      list.sort(compareDateOfServiceDesc);
      setRecords(list);
      const payMap: Record<string, BillingPaymentRow[]> = {};
      await Promise.all(
        list.map(async (row) => {
          try {
            const pr = await fetch(
              `${API_BASE}/billing-records/${encodeURIComponent(row.id)}/payments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
            );
            const pj = pr.ok ? await pr.json() : [];
            payMap[row.id] = Array.isArray(pj) ? pj : [];
          } catch {
            payMap[row.id] = [];
          }
        }),
      );
      setPaymentsByRecord(payMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing records");
      setRecords([]);
      setPaymentsByRecord({});
    }
  }, [statusFilter, dateFrom, dateTo]);

  const loadDetail = useCallback(async (recordId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetailPayments([]);
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
      try {
        const pr = await fetch(
          `${API_BASE}/billing-records/${encodeURIComponent(recordId)}/payments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        );
        const pj = pr.ok ? await pr.json() : [];
        setDetailPayments(Array.isArray(pj) ? pj : []);
      } catch {
        setDetailPayments([]);
      }
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
    setDetailPayments([]);
  }

  function openPaymentModal(recordId: string) {
    setPaymentModalRecordId(recordId);
    setPaymentAmountDollars("");
    setPaymentDate(todayYmdLocal());
    setPaymentMethod("cash");
    setPaymentNote("");
    setDetailError(null);
    setError(null);
  }

  function closePaymentModal() {
    setPaymentModalRecordId(null);
    setPaymentBusy(false);
  }

  async function submitPayment() {
    if (!paymentModalRecordId) return;
    const dollars = parseFloat(paymentAmountDollars);
    if (Number.isNaN(dollars) || dollars <= 0) {
      setError("Enter a valid payment amount greater than zero.");
      return;
    }
    const amount_cents = Math.round(dollars * 100);
    if (!paymentDate.trim()) {
      setError("Payment date is required.");
      return;
    }
    setPaymentBusy(true);
    setError(null);
    setDetailError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing-records/${encodeURIComponent(paymentModalRecordId)}/payments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount_cents,
            payment_date: paymentDate.trim().slice(0, 10),
            payment_method: paymentMethod,
            note: paymentNote.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        setError(msg || `Payment failed (HTTP ${res.status})`);
        return;
      }
      const savedId = paymentModalRecordId;
      closePaymentModal();
      await loadRecords();
      if (detailId && detailId === savedId) {
        await loadDetail(detailId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPaymentBusy(false);
    }
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
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Billing</h1>
          <p className={DS_PAGE_SUBTITLE}>
            CPT billing records and line items
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className={`${DS_PRIMARY_BTN} inline-flex shrink-0 items-center justify-center`}
        >
          + New Billing Record
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
            className={`mt-1 block h-9 w-40 ${DS_INPUT}`}
          >
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={`mt-1 block h-9 ${DS_INPUT}`}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={`mt-1 block h-9 ${DS_INPUT}`}
          />
        </label>
        <label className="block min-w-[12rem] flex-1 text-sm font-medium text-gray-700">
          Search patient
          <input
            type="search"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="Filter by name…"
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
                <th className={DS_TH}>Date of Service</th>
                <th className={DS_TH}>Patient Name</th>
                <th className={DS_TH}>Billing Type</th>
                <th className={DS_TH}>Total Billed</th>
                <th className={`min-w-[12rem] ${DS_TH}`}>Balance</th>
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
                    No billing records found
                  </td>
                </tr>
              ) : (
                tableRows.map((r) => {
                  const p = patientById.get(r.patient_id);
                  const name = p ? patientDisplayName(p) : "—";
                  const bt = (r.billing_type ?? "cash").toLowerCase();
                  const st = (r.status ?? "draft").toLowerCase();
                  const paid = amountPaidCents(r);
                  const billed = Number(r.total_billed_cents) || 0;
                  const pct = paymentProgressPct(r);
                  const payments = paymentsByRecord[r.id] ?? [];
                  return (
                    <Fragment key={r.id}>
                      <tr className={DS_TR}>
                        <td className={DS_TD_PRIMARY}>
                          {r.date_of_service ?? "—"}
                        </td>
                        <td className={DS_TD_PRIMARY}>{name}</td>
                        <td className={DS_TD_PRIMARY}>
                          <span className={`capitalize ${billingTypePillClass(bt)}`}>
                            {r.billing_type ?? "cash"}
                          </span>
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          {formatUsdFromCents(r.total_billed_cents)}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          <p className="text-sm text-gray-900">
                            Paid {formatUsdFromCents(paid)} of{" "}
                            {formatUsdFromCents(billed)}
                          </p>
                          <div className="mt-2 h-1.5 w-full max-w-[11rem] overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-[#16A34A] transition-[width]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          <span
                            className={`capitalize ${billingStatusBadgeClass(st)}`}
                          >
                            {r.status ?? "draft"}
                          </span>
                        </td>
                        <td className={`${DS_TD_PRIMARY} text-right`}>
                          <div className="flex flex-wrap justify-end gap-2">
                            {showRecordPaymentButton(r) ? (
                              <button
                                type="button"
                                onClick={() => openPaymentModal(r.id)}
                                className={`${DS_SECONDARY_BTN} px-3 py-2`}
                              >
                                Record Payment
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void openDetail(r.id)}
                              className={DS_SECONDARY_BTN}
                            >
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                      {payments.length > 0 ? (
                        <tr className="border-b border-gray-100 bg-gray-50 last:border-0">
                          <td colSpan={7} className="px-6 py-3">
                            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                              Payment history
                            </p>
                            <div className="overflow-x-auto rounded-lg border border-gray-100 bg-white">
                              <table className="min-w-full text-left text-xs">
                                <thead>
                                  <tr className="border-b border-gray-100 text-gray-500">
                                    <th className="px-3 py-2 font-medium">Date</th>
                                    <th className="px-3 py-2 font-medium">Method</th>
                                    <th className="px-3 py-2 font-medium">Amount</th>
                                    <th className="px-3 py-2 font-medium">Note</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {payments.map((pay) => (
                                    <tr
                                      key={pay.id}
                                      className="border-b border-gray-50 last:border-0"
                                    >
                                      <td className="px-3 py-2 text-gray-800">
                                        {pay.payment_date ?? "—"}
                                      </td>
                                      <td className="px-3 py-2 capitalize text-gray-800">
                                        {pay.payment_method ?? "—"}
                                      </td>
                                      <td className="px-3 py-2 font-medium text-gray-900">
                                        {formatUsdFromCents(pay.amount_cents)}
                                      </td>
                                      <td className="max-w-[12rem] truncate px-3 py-2 text-gray-600">
                                        {(pay.note ?? "").trim() || "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
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
            aria-labelledby="billing-create-title"
          >
            <h2
              id="billing-create-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              New billing record
            </h2>
            <div className="space-y-4 pt-5">
              <label className="block text-sm font-medium text-gray-700">
                Patient
                <select
                  value={createPatientId}
                  onChange={(e) => setCreatePatientId(e.target.value)}
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
                Date of service
                <input
                  type="date"
                  value={createDateOfService}
                  onChange={(e) => setCreateDateOfService(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Billing type
                <select
                  value={createBillingType}
                  onChange={(e) => setCreateBillingType(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                >
                  <option value="cash">Cash</option>
                  <option value="insurance">Insurance</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Appointment ID (optional)
                <input
                  type="text"
                  value={createAppointmentId}
                  onChange={(e) => setCreateAppointmentId(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                PI case ID (optional)
                <input
                  type="text"
                  value={createPiCaseId}
                  onChange={(e) => setCreatePiCaseId(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Provider ID (optional)
                <input
                  type="text"
                  value={createProviderId}
                  onChange={(e) => setCreateProviderId(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Insurance carrier (optional)
                <input
                  type="text"
                  value={createInsurance}
                  onChange={(e) => setCreateInsurance(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Claim number (optional)
                <input
                  type="text"
                  value={createClaimNumber}
                  onChange={(e) => setCreateClaimNumber(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
                <textarea
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
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
                {createBusy ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {paymentModalRecordId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div
            className={`w-full max-w-lg ${DS_CARD}`}
            role="dialog"
            aria-modal
            aria-labelledby="billing-payment-title"
          >
            <h2
              id="billing-payment-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              Record payment
            </h2>
            <div className="space-y-4 pt-5">
              <label className="block text-sm font-medium text-gray-700">
                Amount (USD)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={paymentAmountDollars}
                  onChange={(e) => setPaymentAmountDollars(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Payment date
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Payment method
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className={`mt-1 h-9 w-full ${DS_INPUT}`}
                >
                  {PAYMENT_METHOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Note (optional)
                <textarea
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  rows={2}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={closePaymentModal}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={paymentBusy}
                onClick={() => void submitPayment()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
              >
                {paymentBusy ? "Saving…" : "Submit"}
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
            aria-labelledby="billing-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
              <h2
                id="billing-detail-title"
                className="text-lg font-semibold text-gray-900"
              >
                Billing record
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
                <div className={DS_CARD}>
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Patient
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
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
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Date of service
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {detail.date_of_service ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Billing type
                      </p>
                      <span
                        className={`mt-1 capitalize ${billingTypePillClass(
                          (detail.billing_type ?? "cash").toLowerCase(),
                        )}`}
                      >
                        {detail.billing_type ?? "cash"}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                        Status
                      </p>
                      <span
                        className={`mt-1 capitalize ${billingStatusBadgeClass(
                          (detail.status ?? "draft").toLowerCase(),
                        )}`}
                      >
                        {detail.status ?? "draft"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-8">
                    <div>
                      <p className="text-xs text-gray-500">Total billed</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatUsdFromCents(detail.total_billed_cents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Amount paid</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatUsdFromCents(amountPaidCents(detail))}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 max-w-md">
                    <p className="text-sm text-gray-700">
                      Paid {formatUsdFromCents(amountPaidCents(detail))} of{" "}
                      {formatUsdFromCents(detail.total_billed_cents)}
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-[#16A34A]"
                        style={{
                          width: `${paymentProgressPct(detail)}%`,
                        }}
                      />
                    </div>
                  </div>
                  {showRecordPaymentButton(detail) ? (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => openPaymentModal(detail.id)}
                        className={DS_SECONDARY_BTN}
                      >
                        Record Payment
                      </button>
                    </div>
                  ) : null}
                  {detailPayments.length > 0 ? (
                    <div className="mt-6">
                      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                        Payment history
                      </h3>
                      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead className={DS_TABLE_HEAD}>
                              <tr>
                                <th className={`${DS_TH} px-4`}>Date</th>
                                <th className={`${DS_TH} px-4`}>Method</th>
                                <th className={`${DS_TH} px-4`}>Amount</th>
                                <th className={`${DS_TH} px-4`}>Note</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailPayments.map((pay) => (
                                <tr key={pay.id} className={DS_TR}>
                                  <td className="px-4 py-3 text-sm text-gray-900">
                                    {pay.payment_date ?? "—"}
                                  </td>
                                  <td className="px-4 py-3 text-sm capitalize text-gray-900">
                                    {pay.payment_method ?? "—"}
                                  </td>
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                    {formatUsdFromCents(pay.amount_cents)}
                                  </td>
                                  <td className="max-w-[14rem] truncate px-4 py-3 text-sm text-gray-400">
                                    {(pay.note ?? "").trim() || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-6 flex flex-wrap items-end gap-3">
                    <label className="text-sm font-medium text-gray-700">
                      Update status
                      <select
                        value={statusDraft}
                        onChange={(e) => setStatusDraft(e.target.value)}
                        className={`ml-2 h-9 ${DS_INPUT} w-auto min-w-[8rem]`}
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
                      className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
                    >
                      {statusBusy ? "Updating…" : "Update Status"}
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Line items
                  </h3>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className={DS_TABLE_HEAD}>
                          <tr>
                            <th className={DS_TH}>CPT</th>
                            <th className={DS_TH}>Description</th>
                            <th className={DS_TH}>Units</th>
                            <th className={DS_TH}>Rate</th>
                            <th className={DS_TH}>Total</th>
                            <th className={DS_TH}>Payment</th>
                            <th className={DS_TH}>Modifiers</th>
                            <th className={`${DS_TH} text-right`}>Delete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.line_items ?? []).length === 0 ? (
                            <tr>
                              <td
                                colSpan={8}
                                className="px-6 py-4 text-center text-gray-500"
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
                                <tr key={li.id} className={DS_TR}>
                                  <td className={`${DS_TD_PRIMARY} font-mono text-xs`}>
                                    {li.cpt_code ?? "—"}
                                  </td>
                                  <td className={`max-w-[10rem] truncate ${DS_TD_PRIMARY}`}>
                                    {li.description ?? "—"}
                                  </td>
                                  <td className={DS_TD_PRIMARY}>{li.units ?? "—"}</td>
                                  <td className={DS_TD_PRIMARY}>
                                    {formatUsdFromCents(li.rate_cents)}
                                  </td>
                                  <td className={`${DS_TD_PRIMARY} font-medium`}>
                                    {formatUsdFromCents(li.total_cents)}
                                  </td>
                                  <td className={`${DS_TD_PRIMARY} capitalize`}>
                                    {li.payment_type ?? "—"}
                                  </td>
                                  <td className={`${DS_TD_PRIMARY} text-xs text-gray-400`}>
                                    {modStr}
                                  </td>
                                  <td className={`${DS_TD_PRIMARY} text-right`}>
                                    <button
                                      type="button"
                                      disabled={deleteBusyId === li.id}
                                      onClick={() => void deleteLineItem(li.id)}
                                      className="text-sm font-medium text-red-500 transition-colors hover:text-red-700 disabled:opacity-50"
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
                </div>

                {!lineFormOpen ? (
                  <button
                    type="button"
                    onClick={() => setLineFormOpen(true)}
                    className={DS_SECONDARY_BTN}
                  >
                    Add Line Item
                  </button>
                ) : (
                  <div className={DS_CARD}>
                    <p className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
                      New line item
                    </p>
                    <div className="grid gap-4 pt-5 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-gray-700">
                        CPT code
                        <input
                          type="text"
                          value={lineCpt}
                          onChange={(e) => setLineCpt(e.target.value)}
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                      <label className="block text-sm font-medium text-gray-700">
                        Description
                        <input
                          type="text"
                          value={lineDescription}
                          onChange={(e) => setLineDescription(e.target.value)}
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                      <label className="block text-sm font-medium text-gray-700">
                        Units
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={lineUnits}
                          onChange={(e) => setLineUnits(e.target.value)}
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                      <label className="block text-sm font-medium text-gray-700">
                        Rate (USD)
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={lineRateDollars}
                          onChange={(e) => setLineRateDollars(e.target.value)}
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={lineTimed}
                          onChange={(e) => setLineTimed(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300"
                          style={{ accentColor: "#16A34A" }}
                        />
                        Is timed
                      </label>
                      <label className="block text-sm font-medium text-gray-700">
                        Payment type
                        <select
                          value={linePaymentType}
                          onChange={(e) =>
                            setLinePaymentType(
                              e.target.value as "cash" | "insurance",
                            )
                          }
                          className={`mt-1 h-9 w-full ${DS_INPUT}`}
                        >
                          <option value="cash">Cash</option>
                          <option value="insurance">Insurance</option>
                        </select>
                      </label>
                      <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                        Modifiers (comma-separated)
                        <input
                          type="text"
                          value={lineModifiers}
                          onChange={(e) => setLineModifiers(e.target.value)}
                          placeholder="e.g. 59, LT"
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                    </div>
                    <div className="mt-6 flex gap-2 border-t border-gray-100 pt-5">
                      <button
                        type="button"
                        onClick={() => setLineFormOpen(false)}
                        className={DS_SECONDARY_BTN}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={lineBusy}
                        onClick={() => void submitLineItem()}
                        className={`${DS_PRIMARY_BTN} disabled:opacity-60`}
                      >
                        {lineBusy ? "Saving…" : "Submit"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
  dmeBillingStatusBadgeClass,
} from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";

const LABEL_CLASS =
  "block text-xs font-medium uppercase tracking-wide text-gray-500";

export type DmeRecord = {
  id: string;
  clinic_id?: string;
  patient_id?: string;
  item_name?: string | null;
  l_code?: string | null;
  date_issued?: string | null;
  quantity?: number | null;
  unit_cost?: number | string | null;
  billing_status?: string | null;
  pi_case_id?: string | null;
  patient_signature_url?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type BillingStatus = "unbilled" | "billed" | "paid" | "written_off";

const BILLING_OPTIONS: { value: BillingStatus; label: string }[] = [
  { value: "unbilled", label: "Unbilled" },
  { value: "billed", label: "Billed" },
  { value: "paid", label: "Paid" },
  { value: "written_off", label: "Written Off" },
];

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function getTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatIssueDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const s = String(raw).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

function formatUnitCost(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function notesPreview(text: string | null | undefined, max = 48): string {
  const s = (text ?? "").trim();
  if (!s) return "—";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function normalizeBillingStatus(s: string | null | undefined): BillingStatus {
  const v = (s ?? "unbilled").toLowerCase().replace(/\s+/g, "_");
  if (v === "billed" || v === "paid" || v === "written_off" || v === "unbilled") {
    return v;
  }
  return "unbilled";
}

function displayBillingLabel(status: string): string {
  const s = status.toLowerCase().replace(/_/g, " ");
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export type DmeSectionProps = {
  clinicId: string;
  patientId: string;
};

export function DmeSection({ clinicId, patientId }: DmeSectionProps) {
  const [rows, setRows] = useState<DmeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DmeRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [itemName, setItemName] = useState("");
  const [lCode, setLCode] = useState("");
  const [dateIssued, setDateIssued] = useState(() => getTodayYmd());
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [billingStatus, setBillingStatus] = useState<BillingStatus>("unbilled");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    if (!clinicId.trim() || !patientId.trim()) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        clinic_id: clinicId.trim(),
        patient_id: patientId.trim(),
      });
      const res = await fetch(`${API_BASE}/dme?${params.toString()}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setError((await res.text().catch(() => "")).trim() || `Error ${res.status}`);
        setRows([]);
        return;
      }
      const json = (await res.json()) as unknown;
      setRows(Array.isArray(json) ? (json as DmeRecord[]) : []);
    } catch {
      setError("Could not load DME records.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, patientId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  function openAdd() {
    setError(null);
    setEditing(null);
    setItemName("");
    setLCode("");
    setDateIssued(getTodayYmd());
    setQuantity("1");
    setUnitCost("");
    setBillingStatus("unbilled");
    setNotes("");
    setModalOpen(true);
  }

  function openEdit(row: DmeRecord) {
    setError(null);
    setEditing(row);
    setItemName((row.item_name ?? "").trim());
    setLCode((row.l_code ?? "").trim());
    const di = row.date_issued ? String(row.date_issued).slice(0, 10) : getTodayYmd();
    setDateIssued(di || getTodayYmd());
    setQuantity(String(row.quantity ?? 1));
    const uc = row.unit_cost;
    if (uc === null || uc === undefined || uc === "") setUnitCost("");
    else setUnitCost(String(uc));
    setBillingStatus(normalizeBillingStatus(row.billing_status));
    setNotes((row.notes ?? "").trim());
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
  }

  async function handleSave() {
    const name = itemName.trim();
    if (!name) {
      setError("Item name is required.");
      return;
    }
    const qty = Math.max(1, Math.floor(Number(quantity)) || 1);
    const body: Record<string, unknown> = {
      item_name: name,
      l_code: lCode.trim() || null,
      date_issued: dateIssued,
      quantity: qty,
      billing_status: billingStatus,
      notes: notes.trim() || null,
    };
    const ucTrim = unitCost.trim();
    if (ucTrim !== "") {
      const n = Number(ucTrim);
      if (!Number.isFinite(n) || n < 0) {
        setError("Unit cost must be a valid non-negative number.");
        return;
      }
      body.unit_cost = n;
    } else if (editing) {
      body.unit_cost = null;
    }

    setSaving(true);
    setError(null);
    try {
      const h = await authHeaders();
      if (editing?.id) {
        const res = await fetch(
          `${API_BASE}/dme/${encodeURIComponent(editing.id)}`,
          {
            method: "PATCH",
            headers: h,
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          setError((await res.text().catch(() => "")).trim() || `Error ${res.status}`);
          return;
        }
      } else {
        const createBody = {
          clinic_id: clinicId.trim(),
          patient_id: patientId.trim(),
          ...body,
        };
        const res = await fetch(`${API_BASE}/dme`, {
          method: "POST",
          headers: h,
          body: JSON.stringify(createBody),
        });
        if (!res.ok) {
          setError((await res.text().catch(() => "")).trim() || `Error ${res.status}`);
          return;
        }
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: DmeRecord) {
    const id = row.id;
    if (!id) return;
    const label = (row.item_name ?? "").trim() || "this item";
    if (
      !window.confirm(
        `Delete DME record "${label}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/dme/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setError((await res.text().catch(() => "")).trim() || `Error ${res.status}`);
        return;
      }
      await load();
    } catch {
      setError("Delete failed.");
    }
  }

  if (!clinicId.trim() || !patientId.trim()) {
    return (
      <div className="mt-10 rounded-[14px] border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
        Select a clinic and patient to view DME records.
      </div>
    );
  }

  const modalTitle = editing ? "Edit DME Item" : "Add DME Item";

  return (
    <div className="mt-10">
      <div className={DS_TABLE_WRAP}>
        <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
            DME / Bracing
          </h2>
          <button
            type="button"
            onClick={openAdd}
            className={`${DS_PRIMARY_BTN} inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-4`}
          >
            + Add Item
          </button>
        </div>

        {error ? (
          <p className="border-b border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 sm:px-6">
            {error}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Item</th>
                <th className={DS_TH}>L-Code</th>
                <th className={DS_TH}>Date Issued</th>
                <th className={DS_TH}>Qty</th>
                <th className={DS_TH}>Unit Cost</th>
                <th className={DS_TH}>Billing Status</th>
                <th className={DS_TH}>Notes</th>
                <th className={`${DS_TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-gray-500"
                  >
                    No DME records for this patient.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const st = normalizeBillingStatus(row.billing_status);
                  const fullNotes = (row.notes ?? "").trim();
                  return (
                    <tr key={row.id} className={DS_TR}>
                      <td className={`${DS_TD_PRIMARY} font-medium`}>
                        {(row.item_name ?? "").trim() || "—"}
                      </td>
                      <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                        {(row.l_code ?? "").trim() || "—"}
                      </td>
                      <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                        {formatIssueDate(row.date_issued ?? undefined)}
                      </td>
                      <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                        {row.quantity ?? 1}
                      </td>
                      <td className={`${DS_TD_PRIMARY} tabular-nums`}>
                        {formatUnitCost(row.unit_cost)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <span className={dmeBillingStatusBadgeClass(st)}>
                          {displayBillingLabel(st)}
                        </span>
                      </td>
                      <td
                        className={`${DS_TD_PRIMARY} max-w-[200px]`}
                        title={fullNotes || undefined}
                      >
                        {notesPreview(row.notes)}
                      </td>
                      <td className={`${DS_TD_PRIMARY} text-right`}>
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-3 text-sm font-medium text-[var(--color-primary,#16A34A)] hover:bg-green-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(row)}
                            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dme-modal-title"
          onClick={closeModal}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-gray-100 px-5 py-4">
              <h3
                id="dme-modal-title"
                className="text-lg font-semibold text-gray-900"
              >
                {modalTitle}
              </h3>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label htmlFor="dme-item-name" className={LABEL_CLASS}>
                  Item Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="dme-item-name"
                  className={`mt-1 ${DS_INPUT}`}
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="dme-l-code" className={LABEL_CLASS}>
                  L-Code
                </label>
                <input
                  id="dme-l-code"
                  className={`mt-1 ${DS_INPUT}`}
                  value={lCode}
                  onChange={(e) => setLCode(e.target.value)}
                  placeholder="e.g. L0650"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-gray-500">e.g. L0650</p>
              </div>
              <div>
                <label htmlFor="dme-date" className={LABEL_CLASS}>
                  Date Issued <span className="text-red-600">*</span>
                </label>
                <input
                  id="dme-date"
                  type="date"
                  className={`mt-1 ${DS_INPUT}`}
                  value={dateIssued}
                  onChange={(e) => setDateIssued(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="dme-qty" className={LABEL_CLASS}>
                  Quantity
                </label>
                <input
                  id="dme-qty"
                  type="number"
                  min={1}
                  step={1}
                  className={`mt-1 ${DS_INPUT}`}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="dme-cost" className={LABEL_CLASS}>
                  Unit Cost
                </label>
                <input
                  id="dme-cost"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  className={`mt-1 ${DS_INPUT}`}
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="dme-billing" className={LABEL_CLASS}>
                  Billing Status
                </label>
                <select
                  id="dme-billing"
                  className={`mt-1 ${DS_INPUT}`}
                  value={billingStatus}
                  onChange={(e) =>
                    setBillingStatus(e.target.value as BillingStatus)
                  }
                >
                  {BILLING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dme-notes" className={LABEL_CLASS}>
                  Notes
                </label>
                <textarea
                  id="dme-notes"
                  className={`mt-1 min-h-[100px] ${DS_INPUT}`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className={`${DS_SECONDARY_BTN} min-h-[44px] w-full sm:w-auto`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className={`${DS_PRIMARY_BTN} min-h-[44px] w-full disabled:opacity-50 sm:w-auto`}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

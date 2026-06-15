"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";

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

type FeeScheduleRow = {
  id: string;
  cpt_code: string;
  description?: string | null;
  charge: number;
};

type CptOption = {
  code: string;
  description: string;
};

type FormModalProps = {
  isOpen: boolean;
  title: string;
  cptCode: string;
  description: string;
  defaultRate: string;
  cptReadOnly?: boolean;
  busy: boolean;
  error: string | null;
  onCptCodeChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onDefaultRateChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function parseRate(raw: string): number | null {
  const n = Number(String(raw).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function FeeScheduleFormModal({
  isOpen,
  title,
  cptCode,
  description,
  defaultRate,
  cptReadOnly,
  busy,
  error,
  onCptCodeChange,
  onDescriptionChange,
  onDefaultRateChange,
  onClose,
  onSubmit,
}: FormModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="fee-schedule-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="fee-schedule-modal-title"
          className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
        >
          {title}
        </h2>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            CPT Code
            <input
              type="text"
              value={cptCode}
              onChange={(e) => onCptCodeChange(e.target.value.toUpperCase())}
              readOnly={cptReadOnly}
              className={`mt-1 ${DS_INPUT} ${cptReadOnly ? "bg-gray-50" : ""}`}
              placeholder="e.g. 97110"
              required
            />
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Description
            <input
              type="text"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="Therapeutic exercises"
              required
            />
          </label>

          <label className="block text-sm font-medium text-gray-700">
            Default Rate
            <input
              type="number"
              min="0"
              step="0.01"
              value={defaultRate}
              onChange={(e) => onDefaultRateChange(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="0.00"
              required
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={DS_SECONDARY_BTN}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BillingFeeSchedule() {
  const { clinicId } = useClinic();
  const [rows, setRows] = useState<FeeScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<FeeScheduleRow | null>(null);
  const [formCpt, setFormCpt] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formRate, setFormRate] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadSchedule = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/fee-schedule?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof err?.detail === "string"
            ? err.detail
            : `Failed to load fee schedule (${res.status})`,
        );
      }
      const data = await res.json();
      setRows(Array.isArray(data) ? (data as FeeScheduleRow[]) : []);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not load fee schedule.",
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!addOpen || !formCpt.trim()) return;
    const code = formCpt.trim().toUpperCase();
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/billing/cpt-codes?search=${encodeURIComponent(code)}`,
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as CptOption[];
        const match = Array.isArray(data)
          ? data.find((c) => c.code.toUpperCase() === code)
          : undefined;
        if (match && !cancelled) {
          setFormDescription(match.description);
        }
      } catch {
        /* ignore lookup errors */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [addOpen, formCpt]);

  function openAdd() {
    setFormCpt("");
    setFormDescription("");
    setFormRate("");
    setFormError(null);
    setAddOpen(true);
  }

  function openEdit(row: FeeScheduleRow) {
    setEditRow(row);
    setFormCpt(row.cpt_code);
    setFormDescription(row.description ?? "");
    setFormRate(String(row.charge));
    setFormError(null);
  }

  function closeModals() {
    if (formBusy) return;
    setAddOpen(false);
    setEditRow(null);
    setFormError(null);
  }

  async function submitAdd() {
    const code = formCpt.trim().toUpperCase();
    const desc = formDescription.trim();
    const rate = parseRate(formRate);
    if (!code) {
      setFormError("CPT code is required.");
      return;
    }
    if (!desc) {
      setFormError("Description is required.");
      return;
    }
    if (rate == null) {
      setFormError("Enter a valid default rate greater than zero.");
      return;
    }

    setFormBusy(true);
    setFormError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/fee-schedule?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify({
            cpt_code: code,
            description: desc,
            charge: rate,
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        setFormError(
          typeof err?.detail === "string"
            ? err.detail
            : `Could not add code (${res.status})`,
        );
        return;
      }
      setToast({ kind: "success", message: "CPT code added" });
      closeModals();
      await loadSchedule();
    } catch {
      setFormError("Could not add CPT code.");
    } finally {
      setFormBusy(false);
    }
  }

  async function submitEdit() {
    if (!editRow) return;
    const desc = formDescription.trim();
    const rate = parseRate(formRate);
    if (!desc) {
      setFormError("Description is required.");
      return;
    }
    if (rate == null) {
      setFormError("Enter a valid default rate greater than zero.");
      return;
    }

    setFormBusy(true);
    setFormError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/fee-schedule/${encodeURIComponent(editRow.id)}?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify({
            description: desc,
            charge: rate,
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        setFormError(
          typeof err?.detail === "string"
            ? err.detail
            : `Could not update code (${res.status})`,
        );
        return;
      }
      setToast({ kind: "success", message: "Fee schedule updated" });
      closeModals();
      await loadSchedule();
    } catch {
      setFormError("Could not update CPT code.");
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDelete(row: FeeScheduleRow) {
    const ok = window.confirm(
      `Remove ${row.cpt_code} from the fee schedule?`,
    );
    if (!ok) return;

    try {
      const res = await fetch(
        `${API_BASE}/billing/fee-schedule/${encodeURIComponent(row.id)}?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: "DELETE", headers: await authHeaders() },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        setToast({
          kind: "error",
          message:
            typeof err?.detail === "string"
              ? err.detail
              : "Could not delete CPT code",
        });
        return;
      }
      setToast({ kind: "success", message: "CPT code removed" });
      await loadSchedule();
    } catch {
      setToast({ kind: "error", message: "Could not delete CPT code" });
    }
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="mb-1 text-sm">
            <Link
              href="/admin/billing"
              className="font-medium text-teal-600 hover:text-teal-700"
            >
              ← Back to Billing
            </Link>
          </p>
          <h1 className={DS_PAGE_TITLE}>Fee Schedule</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Default rates by CPT code for claims and superbills
          </p>
        </div>
        <button type="button" onClick={openAdd} className={DS_PRIMARY_BTN}>
          + Add CPT Code
        </button>
      </div>

      <div className={DS_CARD}>
        {loadError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
          </div>
        ) : null}

        <div className={DS_TABLE_WRAP}>
          <table className="min-w-full divide-y divide-gray-100">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>CPT Code</th>
                <th className={DS_TH}>Description</th>
                <th className={DS_TH}>Default Rate</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    Loading fee schedule…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    No CPT codes configured. Add codes or run the seed SQL in
                    Supabase.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className={DS_TR}>
                    <td className={`${DS_TD_PRIMARY} font-mono text-sm`}>
                      {row.cpt_code}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {row.description ?? "—"}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {formatRate(row.charge)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
                          aria-label={`Edit ${row.cpt_code}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(row)}
                          className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Delete ${row.cpt_code}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <FeeScheduleFormModal
        isOpen={addOpen}
        title="Add CPT Code"
        cptCode={formCpt}
        description={formDescription}
        defaultRate={formRate}
        busy={formBusy}
        error={formError}
        onCptCodeChange={setFormCpt}
        onDescriptionChange={setFormDescription}
        onDefaultRateChange={setFormRate}
        onClose={closeModals}
        onSubmit={() => void submitAdd()}
      />

      <FeeScheduleFormModal
        isOpen={Boolean(editRow)}
        title="Edit CPT Code"
        cptCode={formCpt}
        description={formDescription}
        defaultRate={formRate}
        cptReadOnly
        busy={formBusy}
        error={formError}
        onCptCodeChange={setFormCpt}
        onDescriptionChange={setFormDescription}
        onDefaultRateChange={setFormRate}
        onClose={closeModals}
        onSubmit={() => void submitEdit()}
      />

      {toast ? (
        <div
          className={`fixed right-4 bottom-4 z-[70] rounded-lg px-4 py-2 text-sm font-medium text-white shadow-lg ${
            toast.kind === "success" ? "bg-[#16A34A]" : "bg-[#DC2626]"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

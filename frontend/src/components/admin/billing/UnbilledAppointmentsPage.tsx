"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import NewClaimModal, {
  type NewClaimPrefill,
} from "@/components/admin/appointments/NewClaimModal";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type UnbilledAppointmentRow = {
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  clinician_id?: string | null;
  clinician_name: string;
  date_of_service: string | null;
  appointment_type?: string | null;
  suggested_cpt_codes?: string[];
  suggested_total_amount?: number | null;
};

type UnbilledResponse = {
  total: number;
  appointments: UnbilledAppointmentRow[];
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(
      value.includes("T") ? value : `${value}T12:00:00`,
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value.slice(0, 10);
  }
}

function toPrefill(row: UnbilledAppointmentRow): NewClaimPrefill {
  return {
    patient_id: row.patient_id,
    patient_first_name: row.patient_first_name,
    patient_last_name: row.patient_last_name,
    clinician_id: row.clinician_id,
    appointment_id: row.appointment_id,
    first_treatment_date: row.date_of_service ?? "",
    cpt_codes: row.suggested_cpt_codes,
    total_amount: row.suggested_total_amount,
  };
}

export default function UnbilledAppointmentsPage() {
  const { clinicId } = useClinic();
  const [rows, setRows] = useState<UnbilledAppointmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimPrefill, setClaimPrefill] = useState<NewClaimPrefill | null>(
    null,
  );
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const loadUnbilled = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/billing/unbilled-appointments?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof err?.detail === "string"
            ? err.detail
            : `Failed to load unbilled appointments (${res.status})`,
        );
      }
      const data = (await res.json()) as UnbilledResponse;
      setRows(Array.isArray(data.appointments) ? data.appointments : []);
      setTotal(typeof data.total === "number" ? data.total : 0);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not load unbilled appointments.",
      );
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadUnbilled();
  }, [loadUnbilled]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function openCreateClaim(row: UnbilledAppointmentRow) {
    setClaimPrefill(toPrefill(row));
    setIsClaimModalOpen(true);
  }

  function closeClaimModal() {
    setIsClaimModalOpen(false);
    setClaimPrefill(null);
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-6">
        <p className="mb-1 text-sm">
          <Link
            href="/admin/billing"
            className="font-medium text-teal-600 hover:text-teal-700"
          >
            ← Back to Billing
          </Link>
        </p>
        <h1 className={DS_PAGE_TITLE}>Unbilled Appointments</h1>
        <p className={DS_PAGE_SUBTITLE}>
          {loading
            ? "Loading completed visits without claims…"
            : `${total} completed visit${total === 1 ? "" : "s"} missing charges`}
        </p>
      </div>

      <div className={DS_CARD}>
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className={DS_TABLE_WRAP}>
          <table className="min-w-full divide-y divide-gray-100">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Patient</th>
                <th className={DS_TH}>Clinician</th>
                <th className={DS_TH}>Date of Service</th>
                <th className={DS_TH}>Appointment Type</th>
                <th className={DS_TH}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    Loading unbilled appointments…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-sm text-gray-500"
                  >
                    No unbilled appointments — all completed visits have claims.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.appointment_id} className={DS_TR}>
                    <td className={DS_TD_PRIMARY}>{row.patient_name}</td>
                    <td className={DS_TD_PRIMARY}>{row.clinician_name}</td>
                    <td className={DS_TD_PRIMARY}>
                      {formatDate(row.date_of_service)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {row.appointment_type ?? "—"}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <button
                        type="button"
                        onClick={() => openCreateClaim(row)}
                        className={`${DS_PRIMARY_BTN} text-xs`}
                      >
                        + Create Claim
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewClaimModal
        isOpen={isClaimModalOpen}
        onClose={closeClaimModal}
        prefill={claimPrefill}
        onSuccess={() => {
          setToast({ kind: "success", message: "Claim created" });
          closeClaimModal();
          void loadUnbilled();
        }}
        onError={(message) => setToast({ kind: "error", message })}
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

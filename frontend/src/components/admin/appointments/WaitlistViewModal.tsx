"use client";

import { useCallback, useEffect, useState } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  formatWaitlistTime,
  waitlistPatientName,
  WaitlistEntry,
} from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type ClinicianOption = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
};

export type WaitlistBookRequest = {
  patient: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  };
  date?: string;
  time?: string;
  clinicianId?: string;
  waitlistEntryId: string;
};

export type WaitlistViewModalProps = {
  open: boolean;
  onClose: () => void;
  onBookNow: (request: WaitlistBookRequest) => void;
  onChanged?: () => void;
};

function clinicianLabel(c: ClinicianOption): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return c.title ? `${n}, ${c.title}` : n || "Provider";
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCreated(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export default function WaitlistViewModal({
  open,
  onClose,
  onBookNow,
  onChanged,
}: WaitlistViewModalProps) {
  const { clinicId } = useClinic();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clinicianMap = useCallback(() => {
    const m = new Map<string, string>();
    for (const c of clinicians) {
      m.set(c.id, clinicianLabel(c));
    }
    return m;
  }, [clinicians]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await authHeaders();
      const [listRes, clinRes] = await Promise.all([
        fetch(
          `${API_BASE}/api/waitlist?clinic_id=${encodeURIComponent(clinicId)}&status=waiting`,
          { headers: h },
        ),
        fetch(
          `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        ),
      ]);
      const listJson = listRes.ok ? await listRes.json() : [];
      const clinJson = clinRes.ok ? await clinRes.json() : [];
      setEntries(Array.isArray(listJson) ? listJson : []);
      setClinicians(Array.isArray(clinJson) ? clinJson : []);
    } catch {
      setError("Failed to load waitlist.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    if (!open) return;
    void loadEntries();
  }, [open, loadEntries]);

  async function handleRemove(entry: WaitlistEntry) {
    const ok = window.confirm(
      `Remove ${waitlistPatientName(entry)} from the waitlist?`,
    );
    if (!ok) return;
    setBusyId(entry.id);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/waitlist/${encodeURIComponent(entry.id)}`,
        { method: "DELETE", headers: await authHeaders() },
      );
      if (!res.ok) {
        setError(`Remove failed (${res.status})`);
        return;
      }
      await loadEntries();
      onChanged?.();
    } catch {
      setError("Remove failed.");
    } finally {
      setBusyId(null);
    }
  }

  function handleBook(entry: WaitlistEntry) {
    const nested = entry.patients;
    const first =
      entry.patient_first_name ??
      (nested && !Array.isArray(nested) ? nested.first_name : null);
    const last =
      entry.patient_last_name ??
      (nested && !Array.isArray(nested) ? nested.last_name : null);
    const phone =
      entry.patient_phone ??
      (nested && !Array.isArray(nested) ? nested.phone : null);
    const time = entry.requested_time
      ? String(entry.requested_time).slice(0, 5)
      : undefined;
    onBookNow({
      patient: {
        id: entry.patient_id,
        first_name: first,
        last_name: last,
        phone,
      },
      date: entry.requested_date,
      time,
      clinicianId: entry.clinician_id ?? undefined,
      waitlistEntryId: entry.id,
    });
  }

  const providers = clinicianMap();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="waitlist-view-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2
            id="waitlist-view-title"
            className="text-lg font-semibold text-gray-900"
          >
            Waitlist
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
          >
            ✕
          </button>
        </div>

        {error ? (
          <div className="mx-6 mt-4 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-6 pt-4">
          <div className={DS_TABLE_WRAP}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className={DS_TABLE_HEAD}>
                  <tr>
                    <th className={DS_TH}>Patient</th>
                    <th className={DS_TH}>Requested Date</th>
                    <th className={DS_TH}>Time</th>
                    <th className={DS_TH}>Provider</th>
                    <th className={DS_TH}>Reason</th>
                    <th className={DS_TH}>Added</th>
                    <th className={`${DS_TH} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-6 py-10 text-center text-gray-500"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : entries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-6 py-10 text-center text-gray-500"
                      >
                        No one is currently on the waitlist.
                      </td>
                    </tr>
                  ) : (
                    entries.map((entry) => {
                      const busy = busyId === entry.id;
                      const providerName = entry.clinician_id
                        ? providers.get(entry.clinician_id) ?? "—"
                        : "Any";
                      return (
                        <tr key={entry.id} className={DS_TR}>
                          <td className={`${DS_TD_PRIMARY} font-medium`}>
                            {waitlistPatientName(entry)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {formatDate(entry.requested_date)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {formatWaitlistTime(entry.requested_time)}
                          </td>
                          <td className={DS_TD_PRIMARY}>{providerName}</td>
                          <td
                            className={`${DS_TD_PRIMARY} max-w-[160px] truncate`}
                            title={entry.reason ?? ""}
                          >
                            {entry.reason?.trim() || "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {formatCreated(entry.created_at)}
                          </td>
                          <td className={`${DS_TD_PRIMARY} text-right`}>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleBook(entry)}
                                className={`${DS_PRIMARY_BTN} whitespace-nowrap disabled:opacity-50`}
                              >
                                Book Now
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleRemove(entry)}
                                className={`${DS_SECONDARY_BTN} whitespace-nowrap disabled:opacity-50`}
                              >
                                Remove
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
        </div>
      </div>
    </div>
  );
}

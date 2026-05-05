"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TD_SECONDARY,
  DS_TH,
  DS_TR,
  legalStatusBadgeClass,
} from "@/app/admin/designSystem";

import { useClinic } from "@/app/admin/ClinicContext";

const API_BASE = "https://altheon-platform.onrender.com";
const NY = "America/New_York";

/** Backend GET /legal-requests may not exist on Render yet — UI still works with empty data. */

type LegalRequestRow = {
  id: string;
  created_at?: string;
  attorney_name?: string;
  firm_name?: string;
  attorney_phone?: string;
  patient_name?: string;
  request_type?: string;
  status?: string;
};

function formatReceived(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export default function AdminLegalRequestsPage() {
  const { clinicId } = useClinic();
  const [rows, setRows] = useState<LegalRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});

  async function refreshRows() {
    setFetchNote(null);
    try {
      const res = await fetch(
        `${API_BASE}/legal-requests?clinic_id=${encodeURIComponent(clinicId)}`,
      );
      if (res.status === 404) {
        setFetchNote(
          "GET /legal-requests is not deployed yet — showing empty list until the endpoint exists.",
        );
        setRows([]);
        return;
      }
      if (!res.ok) {
        setFetchNote(`Could not load legal requests (HTTP ${res.status}).`);
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setFetchNote("Could not load legal requests (network error).");
      setRows([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFetchNote(null);
      try {
        const res = await fetch(
          `${API_BASE}/legal-requests?clinic_id=${encodeURIComponent(clinicId)}`,
        );
        if (res.status === 404) {
          if (!cancelled) {
            setFetchNote(
              "GET /legal-requests is not deployed yet — showing empty list until the endpoint exists.",
            );
            setRows([]);
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) {
            setFetchNote(`Could not load legal requests (HTTP ${res.status}).`);
            setRows([]);
          }
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setFetchNote("Could not load legal requests (network error).");
          setRows([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const total = rows.length;
    let pending = 0;
    let inProgress = 0;
    let completed = 0;
    for (const r of rows) {
      const s = (r.status ?? "").toLowerCase();
      if (s === "pending") pending += 1;
      else if (s === "in_progress") inProgress += 1;
      else if (s === "completed") completed += 1;
    }
    return { total, pending, inProgress, completed };
  }, [rows]);

  async function patchStatus(id: string, status: "in_progress" | "completed") {
    setUpdatingIds((p) => ({ ...p, [id]: true }));
    try {
      const params = new URLSearchParams({
        clinic_id: clinicId,
      });
      const res = await fetch(
        `${API_BASE}/legal-requests/${encodeURIComponent(id)}/status?${params.toString()}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        setFetchNote(
          `Status update failed (HTTP ${res.status}). ${await res.text().catch(() => "")}`.trim(),
        );
        return;
      }
      setFetchNote(null);
      await refreshRows();
    } finally {
      setUpdatingIds((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    }
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <h1 className={DS_PAGE_TITLE}>Legal Requests</h1>
      <p className={DS_PAGE_SUBTITLE}>Attorney and records requests</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          {loading ? "…" : `${counts.total} request${counts.total === 1 ? "" : "s"}`}
        </span>
      </div>

      {fetchNote ? (
        <p className="mt-8 rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {fetchNote}
        </p>
      ) : null}

      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <SummaryCard label="Total Requests" value={String(counts.total)} />
        <SummaryCard label="Pending" value={String(counts.pending)} />
        <SummaryCard label="In Progress" value={String(counts.inProgress)} />
        <SummaryCard label="Completed" value={String(counts.completed)} />
      </div>

      <div className={`${DS_TABLE_WRAP} mt-8`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Date Received</th>
                <th className={DS_TH}>Attorney Name</th>
                <th className={DS_TH}>Firm Name</th>
                <th className={DS_TH}>Phone</th>
                <th className={DS_TH}>Patient Name</th>
                <th className={DS_TH}>Request Type</th>
                <th className={DS_TH}>Status</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-10 text-center text-gray-500"
                  >
                    No legal requests logged yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const st = (row.status ?? "pending").toLowerCase();
                  const busy = !!updatingIds[row.id];
                  return (
                    <tr key={row.id} className={DS_TR}>
                      <td className={`${DS_TD_SECONDARY} whitespace-nowrap`}>
                        {formatReceived(row.created_at)}
                      </td>
                      <td className={`${DS_TD_PRIMARY} font-medium`}>
                        {row.attorney_name ?? "—"}
                      </td>
                      <td className={DS_TD_PRIMARY}>{row.firm_name ?? "—"}</td>
                      <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                        {row.attorney_phone ?? "—"}
                      </td>
                      <td className={`${DS_TD_PRIMARY} font-medium`}>
                        {row.patient_name ?? "—"}
                      </td>
                      <td className={DS_TD_PRIMARY}>{row.request_type ?? "—"}</td>
                      <td className={DS_TD_PRIMARY}>
                        <span className={`capitalize ${legalStatusBadgeClass(st)}`}>
                          {st.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <div className="flex flex-wrap gap-2">
                          {st === "pending" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void patchStatus(row.id, "in_progress")}
                              className={`${DS_PRIMARY_BTN} hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50`}
                            >
                              Start
                            </button>
                          ) : null}
                          {st === "in_progress" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void patchStatus(row.id, "completed")}
                              className={`${DS_PRIMARY_BTN} hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50`}
                            >
                              Complete
                            </button>
                          ) : null}
                          {st === "completed" ? (
                            <span
                              className={`capitalize ${legalStatusBadgeClass(st)}`}
                            >
                              {st.replace(/_/g, " ")}
                            </span>
                          ) : null}
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
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={DS_CARD}>
      <p className="text-3xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="mt-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
    </div>
  );
}

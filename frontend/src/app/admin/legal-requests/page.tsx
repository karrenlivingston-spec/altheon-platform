"use client";

import { useEffect, useMemo, useState } from "react";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
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

function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "pending") return "bg-amber-50 text-amber-800";
  if (s === "in_progress") return "bg-blue-50 text-blue-700";
  if (s === "completed") return "bg-emerald-50 text-emerald-700";
  return "bg-gray-50 text-gray-700";
}

export default function AdminLegalRequestsPage() {
  const [rows, setRows] = useState<LegalRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchNote, setFetchNote] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});

  async function refreshRows() {
    setFetchNote(null);
    try {
      const res = await fetch(
        `${API_BASE}/legal-requests?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
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
          `${API_BASE}/legal-requests?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
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
      await fetch(`${API_BASE}/legal-requests/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
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
    <div className="w-full">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Legal Requests</h1>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <p className="text-sm tracking-wide text-gray-500">
          Attorney and records requests
        </p>
        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
          {loading ? "…" : `${counts.total} request${counts.total === 1 ? "" : "s"}`}
        </span>
      </div>

      {fetchNote ? (
        <p className="mb-6 rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
          {fetchNote}
        </p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Total Requests" value={String(counts.total)} />
        <SummaryCard label="Pending" value={String(counts.pending)} />
        <SummaryCard label="In Progress" value={String(counts.inProgress)} />
        <SummaryCard label="Completed" value={String(counts.completed)} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-white">
              <tr>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date Received
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Attorney Name
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Firm Name
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Phone
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Patient Name
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Request Type
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-6 py-4 text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
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
                    <tr
                      key={row.id}
                      className="transition-colors hover:bg-gray-100"
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-gray-800">
                        {formatReceived(row.created_at)}
                      </td>
                      <td className="px-6 py-4 text-gray-900">
                        {row.attorney_name ?? "—"}
                      </td>
                      <td className="px-6 py-4 text-gray-800">
                        {row.firm_name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-gray-800">
                        {row.attorney_phone ?? "—"}
                      </td>
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {row.patient_name ?? "—"}
                      </td>
                      <td className="px-6 py-4 text-gray-800">
                        {row.request_type ?? "—"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusPillClass(st)}`}
                        >
                          {st.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {st === "pending" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void patchStatus(row.id, "in_progress")}
                              className="rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              Start
                            </button>
                          ) : null}
                          {st === "in_progress" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void patchStatus(row.id, "completed")}
                              className="rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              Complete
                            </button>
                          ) : null}
                          {st === "completed" ? (
                            <span className="text-xs text-gray-400">—</span>
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
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <p className="text-3xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="mt-2 text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
    </div>
  );
}

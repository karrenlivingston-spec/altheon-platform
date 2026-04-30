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
  if (s === "pending")
    return "bg-amber-100 text-amber-900 ring-1 ring-amber-200";
  if (s === "in_progress")
    return "bg-blue-100 text-blue-900 ring-1 ring-blue-200";
  if (s === "completed")
    return "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200";
  return "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200";
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
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900">Legal Requests</h1>
        <span className="inline-flex items-center rounded-full border border-[#2D5E3F]/30 bg-[#2D5E3F]/10 px-3 py-1 text-sm font-medium text-[#2D5E3F]">
          {loading ? "…" : `${counts.total} request${counts.total === 1 ? "" : "s"}`}
        </span>
      </div>

      {fetchNote ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {fetchNote}
        </p>
      ) : null}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Requests" value={String(counts.total)} />
        <SummaryCard label="Pending" value={String(counts.pending)} />
        <SummaryCard label="In Progress" value={String(counts.inProgress)} />
        <SummaryCard label="Completed" value={String(counts.completed)} />
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="px-4 py-3 font-medium text-neutral-700">
                  Date Received
                </th>
                <th className="px-4 py-3 font-medium text-neutral-700">
                  Attorney Name
                </th>
                <th className="px-4 py-3 font-medium text-neutral-700">Firm Name</th>
                <th className="px-4 py-3 font-medium text-neutral-700">Phone</th>
                <th className="px-4 py-3 font-medium text-neutral-700">
                  Patient Name
                </th>
                <th className="px-4 py-3 font-medium text-neutral-700">
                  Request Type
                </th>
                <th className="px-4 py-3 font-medium text-neutral-700">Status</th>
                <th className="px-4 py-3 font-medium text-neutral-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-neutral-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-neutral-500"
                  >
                    No legal requests logged yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const st = (row.status ?? "pending").toLowerCase();
                  const busy = !!updatingIds[row.id];
                  return (
                    <tr
                      key={row.id}
                      className={[
                        "border-b border-neutral-100 transition-colors hover:bg-[#2D5E3F]/5",
                        idx % 2 === 1 ? "bg-neutral-50/80" : "bg-white",
                      ].join(" ")}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-800">
                        {formatReceived(row.created_at)}
                      </td>
                      <td className="px-4 py-3 text-neutral-900">
                        {row.attorney_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-800">
                        {row.firm_name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-800">
                        {row.attorney_phone ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {row.patient_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-neutral-800">
                        {row.request_type ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusPillClass(st)}`}
                        >
                          {st.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {st === "pending" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void patchStatus(row.id, "in_progress")}
                              className="rounded-md bg-[#2D5E3F] px-2.5 py-1 text-xs font-medium text-white hover:opacity-95 disabled:opacity-50"
                            >
                              Start
                            </button>
                          ) : null}
                          {st === "in_progress" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void patchStatus(row.id, "completed")}
                              className="rounded-md bg-[#2D5E3F] px-2.5 py-1 text-xs font-medium text-white hover:opacity-95 disabled:opacity-50"
                            >
                              Complete
                            </button>
                          ) : null}
                          {st === "completed" ? (
                            <span className="text-xs text-neutral-400">—</span>
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
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-2xl font-semibold tabular-nums text-neutral-900">{value}</p>
      <p className="mt-1 text-xs font-medium text-neutral-600">{label}</p>
    </div>
  );
}

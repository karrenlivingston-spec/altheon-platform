"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
  piCaseStatusBadgeClass,
} from "@/app/admin/designSystem";
import { piCasesApiUrl, piCasesAuthHeaders } from "@/components/admin/pi-cases/piCasesApi";
import {
  KANBAN_COLUMNS,
  PiCaseBoardItem,
  PiCaseTopAttorney,
  formatUsd,
} from "@/components/admin/pi-cases/piCasesTypes";

const CLOSED_STATUSES = new Set(["closed_settled", "closed", "settled"]);

function FirmCasesTable({ cases, loading }: { cases: PiCaseBoardItem[]; loading?: boolean }) {
  return (
    <div className={DS_TABLE_WRAP}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className={DS_TABLE_HEAD}>
            <tr>
              <th className={DS_TH}>Patient</th>
              <th className={DS_TH}>Status</th>
              <th className={DS_TH}>Est. Settlement</th>
              <th className={DS_TH}>Settled</th>
              <th className={DS_TH}>DOA</th>
              <th className={DS_TH}>Records Due</th>
              <th className={DS_TH}>Hearing</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                  No cases for this firm.
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.id} className={DS_TR}>
                  <td className={DS_TD_PRIMARY}>{c.patient_name}</td>
                  <td className={DS_TD_PRIMARY}>
                    <span className={piCaseStatusBadgeClass(c.status)}>
                      {c.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className={DS_TD_PRIMARY}>{formatUsd(c.estimated_settlement)}</td>
                  <td className={DS_TD_PRIMARY}>{formatUsd(c.settled_amount)}</td>
                  <td className={DS_TD_PRIMARY}>{c.date_of_accident || "—"}</td>
                  <td className={DS_TD_PRIMARY}>
                    {c.is_overdue ? (
                      <span className="font-medium text-red-600">{c.records_due_date || "—"}</span>
                    ) : (
                      c.records_due_date || "—"
                    )}
                  </td>
                  <td className={DS_TD_PRIMARY}>{c.hearing_date || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PiCasesAttorneyReportsView() {
  const { clinicId } = useClinic();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFirm = searchParams.get("firm");

  const [attorneys, setAttorneys] = useState<PiCaseTopAttorney[]>([]);
  const [firmCases, setFirmCases] = useState<PiCaseBoardItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingFirm, setLoadingFirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAttorneys = useCallback(async () => {
    if (!clinicId) return;
    setLoadingList(true);
    setError(null);
    try {
      const h = await piCasesAuthHeaders();
      const params = new URLSearchParams({ clinic_id: clinicId, limit: "50" });
      const res = await fetch(piCasesApiUrl("/top-attorneys", params), { headers: h });
      setAttorneys(res.ok ? await res.json() : []);
    } catch {
      setError("Could not load attorney list.");
    } finally {
      setLoadingList(false);
    }
  }, [clinicId]);

  const loadFirmCases = useCallback(
    async (firm: string) => {
      if (!clinicId || !firm) return;
      setLoadingFirm(true);
      setError(null);
      try {
        const h = await piCasesAuthHeaders();
        const params = new URLSearchParams({ clinic_id: clinicId, firm_name: firm });
        const res = await fetch(piCasesApiUrl("", params), { headers: h });
        setFirmCases(res.ok ? await res.json() : []);
      } catch {
        setError("Could not load firm cases.");
      } finally {
        setLoadingFirm(false);
      }
    },
    [clinicId],
  );

  useEffect(() => {
    void loadAttorneys();
  }, [loadAttorneys]);

  useEffect(() => {
    if (selectedFirm) void loadFirmCases(selectedFirm);
    else setFirmCases([]);
  }, [selectedFirm, loadFirmCases]);

  const firmSummary = useMemo(() => {
    if (!selectedFirm) return null;
    const open = firmCases.filter((c) => !CLOSED_STATUSES.has(String(c.status).toLowerCase()));
    const closed = firmCases.filter((c) => CLOSED_STATUSES.has(String(c.status).toLowerCase()));
    const totalEst = firmCases.reduce((s, c) => s + (c.estimated_settlement ?? 0), 0);
    const statusCounts: Record<string, number> = {};
    for (const c of firmCases) {
      const st = String(c.status || "unknown");
      statusCounts[st] = (statusCounts[st] ?? 0) + 1;
    }
    return {
      caseCount: firmCases.length,
      openCount: open.length,
      closedCount: closed.length,
      totalEst,
      statusCounts,
    };
  }, [firmCases, selectedFirm]);

  const panelMatch = attorneys.find((a) => a.firm_name === selectedFirm);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Attorney Reports</h1>
          <p className={DS_PAGE_SUBTITLE}>
            {selectedFirm ? `Cases for ${selectedFirm}` : "Select a firm to view its case report"}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedFirm ? (
            <button
              type="button"
              className={DS_SECONDARY_BTN}
              onClick={() => router.push("/admin/pi-cases/attorney-reports")}
            >
              ← All firms
            </button>
          ) : null}
          <Link href="/admin/pi-cases" className={DS_SECONDARY_BTN}>
            PI Cases
          </Link>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!selectedFirm ? (
        <div className={`mt-6 ${DS_CARD}`}>
          <p
            className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            title="Firm names are entered as free text on each case"
          >
            Firm names are free text — near-duplicates (e.g. &quot;Smith &amp; Associates&quot; vs
            &quot;Smith and Associates&quot;) may appear as separate entries.
          </p>
          {loadingList ? (
            <p className="text-sm text-gray-500">Loading firms…</p>
          ) : attorneys.length === 0 ? (
            <p className="text-sm text-gray-500">No attorney data.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {attorneys.map((a) => (
                <li key={a.firm_name}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between py-3 text-left hover:bg-gray-50"
                    onClick={() =>
                      router.push(
                        `/admin/pi-cases/attorney-reports?firm=${encodeURIComponent(a.firm_name)}`,
                      )
                    }
                  >
                    <span className="font-medium text-gray-900">{a.firm_name}</span>
                    <span className="text-sm text-gray-500">
                      {a.case_count} cases · {formatUsd(a.total_value)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className={DS_CARD}>
              <p className="text-2xl font-bold text-gray-900">{firmSummary?.caseCount ?? "—"}</p>
              <p className="text-sm text-gray-600">Total cases</p>
            </div>
            <div className={DS_CARD}>
              <p className="text-2xl font-bold text-gray-900">
                {formatUsd(firmSummary?.totalEst)}
              </p>
              <p className="text-sm text-gray-600">Est. settlement value</p>
              {panelMatch ? (
                <p className="mt-1 text-xs text-gray-500">
                  Dashboard panel: {formatUsd(panelMatch.total_value)} ({panelMatch.case_count}{" "}
                  cases)
                </p>
              ) : null}
            </div>
            <div className={DS_CARD}>
              <p className="text-2xl font-bold text-gray-900">{firmSummary?.openCount ?? "—"}</p>
              <p className="text-sm text-gray-600">Open cases</p>
            </div>
            <div className={DS_CARD}>
              <p className="text-2xl font-bold text-gray-900">{firmSummary?.closedCount ?? "—"}</p>
              <p className="text-sm text-gray-600">Closed / settled</p>
            </div>
          </div>

          <div className={`mt-6 ${DS_CARD}`}>
            <h2 className="text-sm font-semibold text-gray-900">Status breakdown</h2>
            <ul className="mt-3 space-y-1 text-sm text-gray-700">
              {KANBAN_COLUMNS.map((col) => {
                const count = firmSummary?.statusCounts[col.id] ?? 0;
                if (count === 0) return null;
                return (
                  <li key={col.id} className="flex justify-between">
                    <span>{col.label}</span>
                    <span className="font-medium">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-base font-semibold text-gray-900">Cases</h2>
            <FirmCasesTable cases={firmCases} loading={loadingFirm} />
          </div>
        </>
      )}
    </div>
  );
}

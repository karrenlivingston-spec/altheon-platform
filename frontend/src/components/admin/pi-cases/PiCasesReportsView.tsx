"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import PiCasesDonutChart from "@/components/admin/pi-cases/PiCasesDonutChart";
import PiCasesReportCasesTable from "@/components/admin/pi-cases/PiCasesReportCasesTable";
import PiCasesStatCards from "@/components/admin/pi-cases/PiCasesStatCards";
import { piCasesApiUrl, piCasesAuthHeaders } from "@/components/admin/pi-cases/piCasesApi";
import {
  PiCaseBoardItem,
  PiCaseStats,
  PiCaseTopAttorney,
  formatUsd,
} from "@/components/admin/pi-cases/piCasesTypes";

export default function PiCasesReportsView() {
  const { clinicId } = useClinic();
  const [stats, setStats] = useState<PiCaseStats | null>(null);
  const [cases, setCases] = useState<PiCaseBoardItem[]>([]);
  const [attorneys, setAttorneys] = useState<PiCaseTopAttorney[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const h = await piCasesAuthHeaders();
      const params = new URLSearchParams({ clinic_id: clinicId });
      const attyParams = new URLSearchParams({ clinic_id: clinicId, limit: "20" });
      const [statsRes, listRes, attyRes] = await Promise.all([
        fetch(piCasesApiUrl("/stats", params), { headers: h }),
        fetch(piCasesApiUrl("", params), { headers: h }),
        fetch(piCasesApiUrl("/top-attorneys", attyParams), { headers: h }),
      ]);
      setStats(statsRes.ok ? await statsRes.json() : null);
      setCases(listRes.ok ? await listRes.json() : []);
      setAttorneys(attyRes.ok ? await attyRes.json() : []);
    } catch {
      setError("Could not load PI reports.");
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxValue = Math.max(...attorneys.map((a) => a.total_value), 1);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>PI Cases — Reports</h1>
          <p className={DS_PAGE_SUBTITLE}>Clinic-wide personal injury summary</p>
        </div>
        <Link href="/admin/pi-cases" className={DS_SECONDARY_BTN}>
          ← Back to PI Cases
        </Link>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        <PiCasesStatCards stats={stats} loading={loading} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PiCasesDonutChart stats={stats} loading={loading} />
        <div className={DS_CARD}>
          <h2 className="text-base font-semibold text-gray-900">Top Attorneys</h2>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : attorneys.length === 0 ? (
              <p className="text-sm text-gray-500">No attorney data.</p>
            ) : (
              attorneys.map((a) => (
                <div key={a.firm_name}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-900">{a.firm_name}</span>
                    <span className="text-xs text-gray-500">{a.case_count} cases</span>
                  </div>
                  <p className="text-xs text-gray-500">{formatUsd(a.total_value)}</p>
                  <div className="mt-1 h-1.5 rounded-full bg-gray-100">
                    <div
                      className="h-1.5 rounded-full bg-emerald-500"
                      style={{ width: `${(a.total_value / maxValue) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-base font-semibold text-gray-900">All Cases</h2>
        <PiCasesReportCasesTable cases={cases} loading={loading} />
      </div>
    </div>
  );
}

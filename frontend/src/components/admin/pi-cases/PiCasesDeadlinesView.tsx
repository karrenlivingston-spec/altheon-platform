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
import { PiCaseDeadlineList } from "@/components/admin/pi-cases/PiCaseDeadlineList";
import { piCasesApiUrl, piCasesAuthHeaders } from "@/components/admin/pi-cases/piCasesApi";
import { PiCaseDeadline } from "@/components/admin/pi-cases/piCasesTypes";

export default function PiCasesDeadlinesView() {
  const { clinicId } = useClinic();
  const [deadlines, setDeadlines] = useState<PiCaseDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const h = await piCasesAuthHeaders();
      const params = new URLSearchParams({
        clinic_id: clinicId,
        view_all: "true",
        limit: "200",
        horizon_days: "365",
      });
      const res = await fetch(piCasesApiUrl("/deadlines", params), { headers: h });
      setDeadlines(res.ok ? await res.json() : []);
    } catch {
      setError("Could not load deadlines.");
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Upcoming Deadlines</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Records due and hearing dates within the next year (soonest first)
          </p>
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

      <div className={`mt-6 ${DS_CARD}`}>
        <p className="text-sm text-gray-600">
          {loading
            ? "Loading…"
            : `${deadlines.length} deadline${deadlines.length === 1 ? "" : "s"} found`}
        </p>
        <ul className="mt-4 divide-y divide-gray-100">
          <PiCaseDeadlineList
            deadlines={deadlines}
            loading={loading}
            emptyMessage="No deadlines with records_due_date or hearing_date set."
          />
        </ul>
      </div>
    </div>
  );
}

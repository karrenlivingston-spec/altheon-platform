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
import { PiCaseActivityList } from "@/components/admin/pi-cases/PiCaseActivityList";
import { piCasesApiUrl, piCasesAuthHeaders } from "@/components/admin/pi-cases/piCasesApi";
import { PiCaseActivity } from "@/components/admin/pi-cases/piCasesTypes";

const PAGE_SIZE = 50;

export default function PiCasesActivityView() {
  const { clinicId } = useClinic();
  const [items, setItems] = useState<PiCaseActivity[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (pageOffset: number, append: boolean) => {
      if (!clinicId) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const h = await piCasesAuthHeaders();
        const params = new URLSearchParams({
          clinic_id: clinicId,
          view_all: "true",
          limit: String(PAGE_SIZE),
          offset: String(pageOffset),
        });
        const res = await fetch(piCasesApiUrl("/activity", params), { headers: h });
        const json = res.ok ? await res.json() : [];
        const batch = Array.isArray(json) ? json : [];
        setHasMore(batch.length === PAGE_SIZE);
        setItems((prev) => (append ? [...prev, ...batch] : batch));
        setOffset(pageOffset + batch.length);
      } catch {
        setError("Could not load activity.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [clinicId],
  );

  useEffect(() => {
    void fetchPage(0, false);
  }, [fetchPage]);

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Case Activity</h1>
          <p className={DS_PAGE_SUBTITLE}>Full activity feed for PI cases</p>
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
        <ul className="divide-y divide-gray-100">
          <PiCaseActivityList items={items} loading={loading} />
        </ul>
        {hasMore && !loading ? (
          <button
            type="button"
            className="mt-4 text-sm font-medium text-emerald-700 hover:underline disabled:opacity-60"
            disabled={loadingMore}
            onClick={() => void fetchPage(offset, true)}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
} from "@/app/admin/designSystem";
import ClinicReferenceDocumentsPanel from "@/components/admin/performance/ClinicReferenceDocumentsPanel";
import PerformanceCenterAssessmentsTab from "@/components/admin/performance/PerformanceCenterAssessmentsTab";
import PerformanceCenterOverviewTab from "@/components/admin/performance/PerformanceCenterOverviewTab";

type HubTab = "overview" | "assessments" | "research";

const TABS: { id: HubTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "assessments", label: "Assessments" },
  { id: "research", label: "Research" },
];

function parseTab(value: string | null): HubTab {
  if (value === "assessments" || value === "research") return value;
  return "overview";
}

export default function PerformanceCenterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabFromUrl = useMemo(
    () => parseTab(searchParams.get("tab")),
    [searchParams],
  );
  const [activeTab, setActiveTab] = useState<HubTab>(tabFromUrl);

  useEffect(() => {
    setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  const setTab = useCallback(
    (tab: HubTab) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "overview") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const qs = params.toString();
      router.replace(
        qs ? `/admin/performance-center?${qs}` : "/admin/performance-center",
        { scroll: false },
      );
    },
    [router, searchParams],
  );

  return (
    <div className={DS_PAGE_ROOT}>
      <div>
        <h1 className={DS_PAGE_TITLE}>Performance Center</h1>
        <p className={DS_PAGE_SUBTITLE}>
          Clinic-wide Kinvent assessments, athlete testing history, and research
          reference materials.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-2 border-b border-gray-200 pb-px">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={[
                "rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border border-b-white border-gray-200 bg-white text-teal-800 shadow-sm -mb-px"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {activeTab === "overview" ? <PerformanceCenterOverviewTab /> : null}
        {activeTab === "assessments" ? <PerformanceCenterAssessmentsTab /> : null}
        {activeTab === "research" ? <ClinicReferenceDocumentsPanel /> : null}
      </div>
    </div>
  );
}

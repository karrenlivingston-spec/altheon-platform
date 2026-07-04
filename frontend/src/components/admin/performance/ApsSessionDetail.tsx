"use client";

import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Sparkles,
} from "lucide-react";

import {
  DS_CARD,
  DS_SECTION_HEADER,
} from "@/app/admin/designSystem";
import {
  APS_METRIC_LABELS,
  APS_TEST_LABELS,
  APS_TEST_ORDER,
  type ApsFinding,
  type ApsSession,
  apsSessionSummaryLine,
  apsTierBadgeClass,
  apsTierLabel,
  formatApsDate,
  formatMetricValue,
  groupFindingsByTestType,
  isCombinedOnlyFinding,
  isOutlierFinding,
} from "@/components/admin/performance/apsTypes";

type ApsSessionDetailProps = {
  session: ApsSession;
  patientName: string;
  onBack: () => void;
};

function findingKey(f: ApsFinding): string {
  return `${f.test_type}:${f.metric_name}:${f.id ?? ""}`;
}

function MetricRow({
  finding,
  session,
}: {
  finding: ApsFinding;
  session: ApsSession;
}) {
  const summary = session.session_summary;
  const combinedOnly = isCombinedOnlyFinding(finding);
  const notable = Boolean(finding.is_notable);
  const outlier = notable && isOutlierFinding(finding, summary);
  const label = APS_METRIC_LABELS[finding.metric_name] ?? finding.metric_name;

  return (
    <div
      className={[
        "rounded-xl border p-4",
        notable
          ? outlier
            ? "border-slate-300 bg-slate-50/80"
            : "border-blue-200 bg-blue-50/40"
          : "border-gray-100 bg-white",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          {combinedOnly ? (
            <p className="mt-1 text-xs text-gray-500">
              Bilateral / aggregate measurement (not a left-right split)
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notable ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900">
              <Sparkles className="h-3 w-3" aria-hidden />
              Notable asymmetry
            </span>
          ) : null}
          {outlier ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800">
              <AlertCircle className="h-3 w-3" aria-hidden />
              Outlier pattern
            </span>
          ) : null}
        </div>
      </div>

      {combinedOnly ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">
              Combined value
            </dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatMetricValue(finding.combined_value)}{" "}
              {finding.unit ? (
                <span className="font-normal text-gray-600">{finding.unit}</span>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">Left</dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatMetricValue(finding.left_value)}{" "}
              {finding.unit ? (
                <span className="font-normal text-gray-600">{finding.unit}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">Right</dt>
            <dd className="text-sm font-medium text-gray-900">
              {formatMetricValue(finding.right_value)}{" "}
              {finding.unit ? (
                <span className="font-normal text-gray-600">{finding.unit}</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">Asymmetry</dt>
            <dd className="text-sm font-medium text-gray-900">
              {finding.asymmetry_pct != null
                ? `${formatMetricValue(finding.asymmetry_pct)}%`
                : "—"}
            </dd>
          </div>
        </dl>
      )}

      {notable && finding.recommended_next_test ? (
        <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-teal-900">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            Suggested next confirmatory test
          </p>
          <p className="mt-2 text-sm leading-relaxed text-teal-950">
            {finding.recommended_next_test}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ApsSessionDetail({
  session,
  patientName,
  onBack,
}: ApsSessionDetailProps) {
  const findings = session.findings ?? [];
  const summary = session.session_summary;
  const tier = summary?.overall_tier ?? null;
  const grouped = groupFindingsByTestType(findings);

  const orderedTests: string[] = APS_TEST_ORDER.filter((t) => grouped.has(t));
  for (const key of grouped.keys()) {
    if (!orderedTests.includes(key)) {
      orderedTests.push(key);
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to session history
      </button>

      <div className={`${DS_CARD} space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Performance assessment
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">{patientName}</h2>
            <p className="mt-1 text-sm text-gray-600">
              Session date: {formatApsDate(session.session_date)}
            </p>
            {session.source_filename ? (
              <p className="mt-0.5 text-xs text-gray-500">{session.source_filename}</p>
            ) : null}
          </div>
          <span className={apsTierBadgeClass(tier)}>
            <Info className="h-3 w-3" aria-hidden />
            {apsTierLabel(tier)}
          </span>
        </div>

        <p className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-800">
          {apsSessionSummaryLine(summary)}
        </p>

        <p className="text-xs text-gray-500">
          This summary suggests what to test next. It is not a diagnosis or treatment plan.
        </p>
      </div>

      {orderedTests.map((testType) => {
        const testFindings = grouped.get(testType) ?? [];
        if (testFindings.length === 0) return null;
        return (
          <section key={testType} className={DS_CARD}>
            <h3 className={DS_SECTION_HEADER}>
              {APS_TEST_LABELS[testType] ?? testType}
            </h3>
            <div className="space-y-3">
              {testFindings.map((f) => (
                <MetricRow key={findingKey(f)} finding={f} session={session} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

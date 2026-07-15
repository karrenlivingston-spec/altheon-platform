"use client";

import {
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
  piCaseStatusBadgeClass,
} from "@/app/admin/designSystem";
import { PiCaseBoardItem, formatUsd } from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesReportCasesTableProps = {
  cases: PiCaseBoardItem[];
  loading?: boolean;
};

export default function PiCasesReportCasesTable({
  cases,
  loading,
}: PiCasesReportCasesTableProps) {
  return (
    <div className={DS_TABLE_WRAP}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className={DS_TABLE_HEAD}>
            <tr>
              <th className={DS_TH}>Patient</th>
              <th className={DS_TH}>Status</th>
              <th className={DS_TH}>Carrier</th>
              <th className={DS_TH}>Est. Settlement</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-gray-500">
                  No cases found.
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.id} className={DS_TR}>
                  <td className={DS_TD_PRIMARY}>
                    <p className="font-medium">{c.patient_name}</p>
                  </td>
                  <td className={DS_TD_PRIMARY}>
                    <span className={piCaseStatusBadgeClass(c.status)}>
                      {c.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className={DS_TD_PRIMARY}>{c.insurance_carrier || "—"}</td>
                  <td className={DS_TD_PRIMARY}>{formatUsd(c.estimated_settlement)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

type PiCasesAllCasesTableProps = {
  cases: PiCaseBoardItem[];
  loading?: boolean;
  onEdit: (item: PiCaseBoardItem) => void;
};

export default function PiCasesAllCasesTable({
  cases,
  loading,
  onEdit,
}: PiCasesAllCasesTableProps) {
  return (
    <div className={DS_TABLE_WRAP}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className={DS_TABLE_HEAD}>
            <tr>
              <th className={DS_TH}>Patient</th>
              <th className={DS_TH}>Insurance</th>
              <th className={DS_TH}>Attorney / Firm</th>
              <th className={DS_TH}>DOA</th>
              <th className={DS_TH}>Status</th>
              <th className={DS_TH}>Est. Settlement</th>
              <th className={DS_TH}>Records Due</th>
              <th className={DS_TH}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-gray-500">Loading…</td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-gray-500">No cases found.</td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.id} className={DS_TR}>
                  <td className={DS_TD_PRIMARY}>
                    <p className="font-medium">{c.patient_name}</p>
                    {c.patient_pt_id ? (
                      <p className="text-xs text-gray-500">{c.patient_pt_id}</p>
                    ) : null}
                  </td>
                  <td className={DS_TD_PRIMARY}>{c.insurance_carrier || "—"}</td>
                  <td className={DS_TD_PRIMARY}>
                    {[c.attorney_name, c.firm_name].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className={DS_TD_PRIMARY}>{c.date_of_accident || "—"}</td>
                  <td className={DS_TD_PRIMARY}>
                    <span className={piCaseStatusBadgeClass(c.status)}>
                      {c.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className={DS_TD_PRIMARY}>{formatUsd(c.estimated_settlement)}</td>
                  <td className={DS_TD_PRIMARY}>{c.records_due_date || "—"}</td>
                  <td className={DS_TD_PRIMARY}>
                    <button
                      type="button"
                      onClick={() => onEdit(c)}
                      className="text-sm font-medium text-emerald-700 hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

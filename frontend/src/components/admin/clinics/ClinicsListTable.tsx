"use client";

import {
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  ClinicCardData,
  formatUsd,
} from "@/components/admin/clinics/clinicsTypes";

type ClinicsListTableProps = {
  clinics: ClinicCardData[];
  onEdit: (clinic: ClinicCardData) => void;
  onViewDashboard: (clinic: ClinicCardData) => void;
};

export default function ClinicsListTable({
  clinics,
  onEdit,
  onViewDashboard,
}: ClinicsListTableProps) {
  return (
    <div className={DS_TABLE_WRAP}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className={DS_TABLE_HEAD}>
            <tr>
              <th className={DS_TH}>Name</th>
              <th className={DS_TH}>Location</th>
              <th className={DS_TH}>Status</th>
              <th className={DS_TH}>Agent</th>
              <th className={DS_TH}>Patients</th>
              <th className={DS_TH}>Appts MTD</th>
              <th className={DS_TH}>Collected MTD</th>
              <th className={DS_TH}>Collection Rate</th>
              <th className={DS_TH}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clinics.map((c) => (
              <tr key={c.id} className={DS_TR}>
                <td className={`${DS_TD_PRIMARY} font-medium`}>{c.name}</td>
                <td className={DS_TD_PRIMARY}>{c.address}</td>
                <td className={DS_TD_PRIMARY}>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.status === "inactive"
                        ? "bg-gray-100 text-gray-600"
                        : "bg-green-50 text-green-700"
                    }`}
                  >
                    {c.status === "inactive" ? "Inactive" : "Active"}
                  </span>
                </td>
                <td className={DS_TD_PRIMARY}>
                  {c.agent_name}
                  <span className="ml-1 text-xs text-gray-400">
                    ({c.agent_status})
                  </span>
                </td>
                <td className={DS_TD_PRIMARY}>{c.patient_count}</td>
                <td className={DS_TD_PRIMARY}>{c.appointments_mtd}</td>
                <td className={DS_TD_PRIMARY}>{formatUsd(c.collected_mtd)}</td>
                <td className={DS_TD_PRIMARY}>{c.collection_rate_pct}%</td>
                <td className={DS_TD_PRIMARY}>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-[#16a34a] hover:underline"
                      onClick={() => onViewDashboard(c)}
                    >
                      Dashboard
                    </button>
                    <button
                      type="button"
                      className="text-xs font-medium text-gray-600 hover:underline"
                      onClick={() => onEdit(c)}
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

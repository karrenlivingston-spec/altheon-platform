"use client";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  PayerSummaryRow,
  formatUsdFromCents,
} from "@/components/admin/billing/billingTypes";

type PayerSummaryProps = {
  rows: PayerSummaryRow[];
};

export default function PayerSummary({ rows }: PayerSummaryProps) {
  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          Payer Summary (Top 5)
        </h2>
        <span className="text-xs font-medium text-teal-600">View All →</span>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">No payer data yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="pb-2 pr-2 font-semibold uppercase">Payer</th>
                <th className="pb-2 pr-2 font-semibold uppercase">Billed</th>
                <th className="pb-2 pr-2 font-semibold uppercase">Collected</th>
                <th className="pb-2 font-semibold uppercase">% Collected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.carrier} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 pr-2 font-medium text-gray-900">
                    <span className="line-clamp-2">{row.carrier}</span>
                  </td>
                  <td className="py-3 pr-2 text-gray-700">
                    {formatUsdFromCents(row.billed_cents)}
                  </td>
                  <td className="py-3 pr-2 text-gray-700">
                    {formatUsdFromCents(row.collected_cents)}
                  </td>
                  <td className="py-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-gray-900">
                        {row.collection_rate}%
                      </span>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-green-500"
                          style={{
                            width: `${Math.min(100, row.collection_rate)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

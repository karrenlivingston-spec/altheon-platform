"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

import { DS_CARD } from "@/app/admin/designSystem";
import {
  RecentPaymentRow,
  formatUsdFromCentsPrecise,
} from "@/components/admin/billing/billingTypes";

type ERAPanelProps = {
  payments: RecentPaymentRow[];
};

const TOOL_LINKS = [
  { label: "Create Superbill", href: "/admin/clinical-notes" },
  { label: "Insurance Verification", href: "/admin/patients" },
  { label: "Fee Schedule", href: "/admin/billing/fee-schedule" },
  { label: "Patient Statements", href: "/admin/billing" },
];

function formatPaymentDate(value: string): string {
  if (!value) return "—";
  try {
    return new Date(value.includes("T") ? value : `${value}T12:00:00`).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    );
  } catch {
    return value.slice(0, 10);
  }
}

export default function ERAPanel({ payments }: ERAPanelProps) {
  return (
    <div className="space-y-6">
      <div className={DS_CARD}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Electronic Remittance (ERA)
          </h2>
          <span className="text-xs font-medium text-teal-600">View All →</span>
        </div>

        {payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No recent payments</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {payments.map((p, i) => (
              <li key={`${p.payment_date}-${i}`} className="flex items-start gap-3 py-3">
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-green-500"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    Payment from {p.carrier}
                  </p>
                  <p className="text-xs text-gray-500">{p.patient_name}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-gray-900">
                    {formatUsdFromCentsPrecise(p.amount_cents)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatPaymentDate(p.payment_date)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={DS_CARD}>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Tools & Shortcuts
        </h2>
        <ul className="space-y-2">
          {TOOL_LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                className="block rounded-lg px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

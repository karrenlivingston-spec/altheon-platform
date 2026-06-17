"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const REPORT_LINKS = [
  { href: "/admin/billing/aging-report", label: "Aging Report" },
  { href: "/admin/billing/payer-summary", label: "Payer Summary" },
  { href: "/admin/billing/benefits-ledger", label: "Benefits Ledger" },
] as const;

export default function BillingSubNav() {
  const pathname = usePathname();

  return (
    <nav
      className="mb-6 flex flex-wrap gap-2 border-b border-gray-200 pb-4"
      aria-label="Billing reports"
    >
      {REPORT_LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-teal-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200",
            ].join(" ")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

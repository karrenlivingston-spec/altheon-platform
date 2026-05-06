/** Shared Altheon admin UI tokens — visual only, import from admin pages. */

export const DS_PAGE_ROOT =
  "w-full bg-[#f0f4f8] -mx-6 px-8 py-8 pb-10";
export const DS_PAGE_TITLE =
  "text-2xl font-bold tracking-tight text-gray-900";
export const DS_PAGE_SUBTITLE = "text-sm text-gray-500 mt-1";

export const DS_CARD =
  "rounded-[14px] border border-black/10 bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.04)]";
export const DS_CARD_HOVER =
  "transition-shadow duration-200 hover:shadow-md";

export const DS_FILTER_BAR =
  "mb-6 rounded-[14px] border border-black/10 bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.04)]";

export const DS_INPUT =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-[var(--color-primary,#16A34A)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary,#16A34A)]/20";

export const DS_TABLE_WRAP =
  "overflow-hidden rounded-[14px] border border-black/10 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.04)]";
export const DS_TABLE_HEAD = "border-b border-gray-100 bg-gray-50";
export const DS_TH =
  "px-6 py-3 text-left text-xs font-medium uppercase tracking-[0.05em] text-gray-500";
export const DS_TR =
  "border-b border-gray-100 transition-colors duration-150 last:border-0 hover:bg-gray-50";
export const DS_TD_PRIMARY = "px-6 py-4 text-sm text-gray-900";
export const DS_TD_SECONDARY = "px-6 py-4 text-sm text-gray-400";

export const DS_SECTION_HEADER =
  "mb-6 text-sm font-semibold uppercase tracking-[0.05em] text-gray-900";

export const DS_PRIMARY_BTN =
  "rounded-lg bg-[var(--color-primary,#16A34A)] px-4 py-2 text-sm font-medium text-white transition-all duration-150 ease-in hover:-translate-y-px hover:bg-[#15803D]";
export const DS_SECONDARY_BTN =
  "rounded-lg border-[1.5px] border-[var(--color-primary,#16A34A)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-primary,#16A34A)] transition-all duration-150 ease-in hover:-translate-y-px hover:bg-[#f0fdf4]";
export const DS_DESTRUCTIVE_BTN =
  "rounded-lg border border-[#DC2626]/30 bg-white px-4 py-2 text-sm font-medium text-[#DC2626] transition-all duration-150 ease-in hover:-translate-y-px hover:bg-red-50";

const BADGE =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

/** Appointment / visit-style statuses */
export function appointmentStatusBadgeClass(status: string): string {
  const s = status.toLowerCase().replace(/\s+/g, "_");
  switch (s) {
    case "scheduled":
      return `${BADGE} bg-blue-50 text-blue-700`;
    case "confirmed":
      return `${BADGE} bg-green-50 text-green-700`;
    case "checked_in":
      return `${BADGE} bg-amber-50 text-amber-700`;
    case "completed":
      return `${BADGE} bg-gray-100 text-gray-600`;
    case "cancelled":
    case "canceled":
    case "no_show":
      return `${BADGE} bg-red-50 text-red-600`;
    case "pending":
      return `${BADGE} bg-amber-50 text-amber-700`;
    case "in_progress":
      return `${BADGE} bg-blue-50 text-blue-700`;
    default:
      return `${BADGE} bg-gray-100 text-gray-500`;
  }
}

/** Billing record / payment-style statuses */
export function billingStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  switch (s) {
    case "paid":
      return `${BADGE} bg-green-50 text-green-700`;
    case "partial":
      return `${BADGE} bg-amber-50 text-amber-700`;
    case "draft":
      return `${BADGE} bg-gray-100 text-gray-500`;
    case "denied":
      return `${BADGE} bg-red-50 text-red-600`;
    case "submitted":
      return `${BADGE} bg-amber-50 text-amber-700`;
    default:
      return `${BADGE} bg-gray-100 text-gray-500`;
  }
}

/** Legal request workflow */
export function legalStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  switch (s) {
    case "pending":
      return `${BADGE} bg-amber-50 text-amber-700`;
    case "in_progress":
      return `${BADGE} bg-blue-50 text-blue-700`;
    case "completed":
      return `${BADGE} bg-gray-100 text-gray-600`;
    default:
      return `${BADGE} bg-gray-100 text-gray-500`;
  }
}

/** Active / inactive toggles */
export function activeInactiveBadgeClass(active: boolean): string {
  return active
    ? `${BADGE} bg-green-50 text-green-700`
    : `${BADGE} bg-gray-100 text-gray-500`;
}

/** Membership row status */
export function membershipStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "active") return `${BADGE} bg-green-50 text-green-700`;
  if (s === "paused") return `${BADGE} bg-amber-50 text-amber-700`;
  if (s === "cancelled" || s === "canceled")
    return `${BADGE} bg-red-50 text-red-600`;
  if (s === "expired") return `${BADGE} bg-gray-100 text-gray-500`;
  return `${BADGE} bg-gray-100 text-gray-500`;
}

/** PI case lifecycle */
export function piCaseStatusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "open") return `${BADGE} bg-blue-50 text-blue-700`;
  if (s === "in_treatment") return `${BADGE} bg-amber-50 text-amber-700`;
  if (s === "pending_settlement") return `${BADGE} bg-amber-50 text-amber-700`;
  if (s === "settled") return `${BADGE} bg-green-50 text-green-700`;
  if (s === "closed") return `${BADGE} bg-gray-100 text-gray-600`;
  return `${BADGE} bg-gray-100 text-gray-500`;
}

/** Billing type (cash / insurance / mixed) */
export function billingTypePillClass(t: string): string {
  const s = t.toLowerCase();
  if (s === "cash") return `${BADGE} bg-green-50 text-green-700`;
  if (s === "insurance") return `${BADGE} bg-blue-50 text-blue-700`;
  if (s === "mixed") return `${BADGE} bg-amber-50 text-amber-700`;
  return `${BADGE} bg-gray-100 text-gray-500`;
}

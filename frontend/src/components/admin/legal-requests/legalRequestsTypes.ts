export type LegalRequestStatus =
  | "received"
  | "gathering_records"
  | "provider_review"
  | "ready"
  | "delivered"
  | "archived";

export type LegalRequest = {
  id: string;
  clinic_id: string;
  patient_id?: string | null;
  patient_name?: string | null;
  patient_dob?: string | null;
  patient_phone?: string | null;
  requesting_party_name?: string | null;
  requesting_party_type?: string | null;
  request_date?: string | null;
  request_method?: string | null;
  documents_requested?: string[];
  documents_prepared?: string[];
  status?: LegalRequestStatus | string | null;
  send_date?: string | null;
  send_method?: string | null;
  notes?: string | null;
  attorney_name?: string | null;
  firm_name?: string | null;
  attorney_phone?: string | null;
  attorney_email?: string | null;
  request_type?: string | null;
  source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type LegalRequestStats = {
  total: number;
  received: number;
  gathering_records: number;
  provider_review: number;
  ready: number;
  delivered: number;
  overdue: number;
};

export const KANBAN_COLUMNS: Array<{
  id: LegalRequestStatus;
  label: string;
  accent: "blue" | "amber" | "purple" | "green" | "gray";
}> = [
  { id: "received", label: "Received", accent: "blue" },
  { id: "gathering_records", label: "Gathering Records", accent: "amber" },
  { id: "provider_review", label: "Provider Review", accent: "purple" },
  { id: "ready", label: "Ready to Send", accent: "green" },
  { id: "delivered", label: "Delivered", accent: "gray" },
];

export const STATUS_FLOW: LegalRequestStatus[] = [
  "received",
  "gathering_records",
  "provider_review",
  "ready",
  "delivered",
];

export const REQUEST_TYPE_OPTIONS = [
  { value: "medical_records", label: "Medical Records" },
  { value: "billing_records", label: "Billing Records" },
  { value: "full_chart", label: "Full Chart" },
  { value: "imaging", label: "Imaging" },
  { value: "other", label: "Other" },
] as const;

export const PARTY_TYPE_OPTIONS = [
  { value: "attorney", label: "Attorney" },
  { value: "insurance", label: "Insurance" },
  { value: "patient", label: "Patient" },
  { value: "court", label: "Court" },
  { value: "other", label: "Other" },
] as const;

export const REQUEST_METHOD_OPTIONS = [
  { value: "fax", label: "Fax" },
  { value: "email", label: "Email" },
  { value: "mail", label: "Mail" },
  { value: "in_person", label: "In Person" },
] as const;

export function requestTypeLabel(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  return REQUEST_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? value ?? "—";
}

export function patientPtId(patientId: string | null | undefined): string {
  const id = (patientId ?? "").trim();
  if (!id) return "";
  return `PT-${id.replace(/-/g, "").slice(-6).toUpperCase()}`;
}

export function formatRequestDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

export function daysOpen(requestDate: string | null | undefined): number {
  if (!requestDate) return 0;
  const start = new Date(
    requestDate.includes("T") ? requestDate : `${requestDate}T12:00:00`,
  );
  if (Number.isNaN(start.getTime())) return 0;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  start.setHours(12, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
}

export function nextStatus(
  current: string | null | undefined,
): LegalRequestStatus | null {
  const idx = STATUS_FLOW.indexOf((current ?? "") as LegalRequestStatus);
  if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

export function prevStatus(
  current: string | null | undefined,
): LegalRequestStatus | null {
  const idx = STATUS_FLOW.indexOf((current ?? "") as LegalRequestStatus);
  if (idx <= 0) return null;
  return STATUS_FLOW[idx - 1];
}

export const COLUMN_ACCENT: Record<
  (typeof KANBAN_COLUMNS)[number]["accent"],
  { header: string; badge: string }
> = {
  blue: { header: "text-blue-700", badge: "bg-blue-100 text-blue-800" },
  amber: { header: "text-amber-700", badge: "bg-amber-100 text-amber-800" },
  purple: { header: "text-purple-700", badge: "bg-purple-100 text-purple-800" },
  green: { header: "text-green-700", badge: "bg-green-100 text-green-800" },
  gray: { header: "text-gray-700", badge: "bg-gray-200 text-gray-700" },
};

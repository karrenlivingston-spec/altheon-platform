export type WaitlistEntry = {
  id: string;
  clinic_id: string;
  patient_id: string;
  requested_date: string;
  requested_time?: string | null;
  clinician_id?: string | null;
  reason?: string | null;
  notes?: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_phone?: string | null;
  patients?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
  } | null;
};

export type WaitlistPatientOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

export function waitlistPatientName(entry: WaitlistEntry): string {
  const nested = entry.patients;
  const first =
    entry.patient_first_name ??
    (nested && !Array.isArray(nested) ? nested.first_name : null) ??
    "";
  const last =
    entry.patient_last_name ??
    (nested && !Array.isArray(nested) ? nested.last_name : null) ??
    "";
  return `${first} ${last}`.trim() || "Unknown";
}

export function formatWaitlistTime(value: string | null | undefined): string {
  if (!value) return "Any";
  const s = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return s;
  const h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${min} ${ampm}`;
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
} from "@/app/admin/designSystem";

import { useClinic } from "@/app/admin/ClinicContext";

const API_BASE = "https://altheon-platform.onrender.com";

const INPUT_CLASS = `mt-1 block h-9 w-full ${DS_INPUT}`;
const SELECT_CLASS = `mt-1 block h-9 w-full ${DS_INPUT}`;

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
] as const;

const DAY_DEFS = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
] as const;

type DayKey = (typeof DAY_DEFS)[number]["key"];

type DayHours = { enabled: boolean; open: string; close: string };

type ClinicSettingsRow = {
  clinic_id?: string;
  clinic_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  timezone?: string | null;
  billing_model?: string | null;
  business_hours?: unknown;
  providers?: unknown;
};

type ProviderRow = {
  id: string;
  name: string;
  specialty: string;
  color: string;
};

const DEFAULT_PROVIDER_COLOR = "#1A6B8A";

type ProviderEditorState =
  | { open: false }
  | { open: true; mode: "add"; id: string }
  | { open: true; mode: "edit"; id: string };

type BillingModelId = "cash_pay" | "insurance" | "hybrid";

const BILLING_OPTIONS: {
  id: BillingModelId;
  title: string;
  subtitle: string;
}[] = [
  { id: "cash_pay", title: "Cash Pay", subtitle: "Patient pays at time of service" },
  { id: "insurance", title: "Insurance", subtitle: "Primary billing through carriers" },
  {
    id: "hybrid",
    title: "Hybrid (Cash + Insurance)",
    subtitle: "Mix of self-pay and insurance billing",
  },
];

const CLINIC_INFO_KEYS = [
  "clinic_name",
  "phone",
  "email",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "zip",
] as const;

type ClinicInfoForm = Record<(typeof CLINIC_INFO_KEYS)[number], string>;

function emptyClinicInfoForm(): ClinicInfoForm {
  return {
    clinic_name: "",
    phone: "",
    email: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
  };
}

function rowToClinicInfoForm(row: ClinicSettingsRow): ClinicInfoForm {
  return {
    clinic_name: String(row.clinic_name ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
    address_line1: String(row.address_line1 ?? ""),
    address_line2: String(row.address_line2 ?? ""),
    city: String(row.city ?? ""),
    state: String(row.state ?? ""),
    zip: String(row.zip ?? ""),
  };
}

function defaultBusinessHours(): Record<DayKey, DayHours> {
  const init: DayHours = { enabled: false, open: "09:00", close: "17:00" };
  return {
    monday: { ...init },
    tuesday: { ...init },
    wednesday: { ...init },
    thursday: { ...init },
    friday: { ...init },
    saturday: { ...init },
    sunday: { ...init },
  };
}

function normalizeBusinessHours(raw: unknown): Record<DayKey, DayHours> {
  const base = defaultBusinessHours();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const { key } of DAY_DEFS) {
      const v = obj[key];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        base[key] = {
          enabled: Boolean(o.enabled),
          open: typeof o.open === "string" ? o.open.slice(0, 5) : "09:00",
          close: typeof o.close === "string" ? o.close.slice(0, 5) : "17:00",
        };
      }
    }
  }
  return base;
}

function normalizeBillingModel(raw: string | null | undefined): BillingModelId {
  const s = String(raw ?? "").toLowerCase().replace(/\s+/g, "_");
  if (s === "insurance") return "insurance";
  if (s === "hybrid" || s === "mixed") return "hybrid";
  return "cash_pay";
}

function normalizeHexColor(s: string): string {
  const t = s.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(t)) {
    const r = t[1],
      g = t[2],
      b = t[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return DEFAULT_PROVIDER_COLOR;
}

function parseProviders(raw: unknown): ProviderRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    if (!p || typeof p !== "object") {
      return {
        id: crypto.randomUUID(),
        name: "—",
        specialty: "—",
        color: DEFAULT_PROVIDER_COLOR,
      };
    }
    const o = p as Record<string, unknown>;
    const rawId = typeof o.id === "string" ? o.id.trim() : "";
    const id = rawId || crypto.randomUUID();
    const color =
      typeof o.color === "string" && o.color.trim()
        ? normalizeHexColor(o.color)
        : typeof o.hex === "string" && o.hex.trim()
          ? normalizeHexColor(o.hex)
          : DEFAULT_PROVIDER_COLOR;
    return {
      id,
      name: typeof o.name === "string" ? o.name : "—",
      specialty: typeof o.specialty === "string" ? o.specialty : "—",
      color,
    };
  });
}

function providersToPayload(list: ProviderRow[]): ProviderRow[] {
  return list.map((p) => ({
    id: p.id,
    name: p.name.trim() || "Untitled",
    specialty: p.specialty.trim(),
    color: normalizeHexColor(p.color),
  }));
}

function pickChangedClinicFields(
  current: ClinicInfoForm,
  baseline: ClinicInfoForm,
): Partial<Record<(typeof CLINIC_INFO_KEYS)[number], string>> {
  const out: Partial<Record<(typeof CLINIC_INFO_KEYS)[number], string>> = {};
  for (const k of CLINIC_INFO_KEYS) {
    if ((current[k] ?? "") !== (baseline[k] ?? "")) {
      out[k] = current[k] ?? "";
    }
  }
  return out;
}

export default function AdminSettingsPage() {
  const { clinicId } = useClinic();
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [clinicInfo, setClinicInfo] = useState<ClinicInfoForm>(() =>
    emptyClinicInfoForm(),
  );
  const [clinicInfoBaseline, setClinicInfoBaseline] = useState<ClinicInfoForm | null>(
    null,
  );
  const [hours, setHours] = useState<Record<DayKey, DayHours>>(() =>
    defaultBusinessHours(),
  );
  const [hoursBaseline, setHoursBaseline] = useState<Record<DayKey, DayHours> | null>(
    null,
  );
  const [billingModel, setBillingModel] = useState<BillingModelId>("cash_pay");
  const [billingBaseline, setBillingBaseline] = useState<BillingModelId | null>(null);
  const [timezone, setTimezone] = useState<string>("America/New_York");
  const [timezoneBaseline, setTimezoneBaseline] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderRow[]>([]);

  const [providerEditor, setProviderEditor] = useState<ProviderEditorState>({
    open: false,
  });
  const [editorName, setEditorName] = useState("");
  const [editorSpecialty, setEditorSpecialty] = useState("");
  const [editorColor, setEditorColor] = useState(DEFAULT_PROVIDER_COLOR);

  const [savingClinic, setSavingClinic] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [savingBilling, setSavingBilling] = useState(false);
  const [savingTz, setSavingTz] = useState(false);
  const [savingProviders, setSavingProviders] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);

  const [clinicSavedMsg, setClinicSavedMsg] = useState(false);
  const [hoursSavedMsg, setHoursSavedMsg] = useState(false);
  const [billingSavedMsg, setBillingSavedMsg] = useState(false);
  const [tzSavedMsg, setTzSavedMsg] = useState(false);
  const [providersSavedMsg, setProvidersSavedMsg] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(
        `${API_BASE}/clinic-settings/${encodeURIComponent(clinicId)}`,
      );
      if (res.status === 404) {
        setFetchError("Clinic settings were not found for this clinic.");
        setClinicInfoBaseline(null);
        setHoursBaseline(null);
        setBillingBaseline(null);
        setTimezoneBaseline(null);
        return;
      }
      if (!res.ok) {
        setFetchError(`Could not load settings (${res.status}).`);
        return;
      }
      const row = (await res.json()) as ClinicSettingsRow;
      const ci = rowToClinicInfoForm(row);
      setClinicInfo(ci);
      setClinicInfoBaseline({ ...ci });
      const bh = normalizeBusinessHours(row.business_hours);
      setHours(bh);
      setHoursBaseline(JSON.parse(JSON.stringify(bh)) as Record<DayKey, DayHours>);
      const bm = normalizeBillingModel(row.billing_model);
      setBillingModel(bm);
      setBillingBaseline(bm);
      const tz =
        typeof row.timezone === "string" && row.timezone
          ? row.timezone
          : "America/New_York";
      const tzOk = TIMEZONE_OPTIONS.some((o) => o.value === tz);
      setTimezone(tzOk ? tz : "America/New_York");
      setTimezoneBaseline(tzOk ? tz : "America/New_York");
      setProviders(parseProviders(row.providers));
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial clinic settings fetch
    void load();
  }, [load]);

  const clinicInfoDirty = useMemo(() => {
    if (!clinicInfoBaseline) return false;
    return CLINIC_INFO_KEYS.some((k) => clinicInfo[k] !== clinicInfoBaseline[k]);
  }, [clinicInfo, clinicInfoBaseline]);

  const hoursDirty = useMemo(() => {
    if (!hoursBaseline) return false;
    return DAY_DEFS.some(({ key }) => {
      const a = hours[key];
      const b = hoursBaseline[key];
      return a.enabled !== b.enabled || a.open !== b.open || a.close !== b.close;
    });
  }, [hours, hoursBaseline]);

  const billingDirty = billingBaseline !== null && billingModel !== billingBaseline;
  const tzDirty = timezoneBaseline !== null && timezone !== timezoneBaseline;

  async function patchBody(
    body: Record<string, unknown>,
  ): Promise<ClinicSettingsRow | null> {
    setSectionError(null);
    const res = await fetch(
      `${API_BASE}/clinic-settings/${encodeURIComponent(clinicId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      setSectionError(
        detail ? `Save failed (${res.status}): ${detail.slice(0, 200)}` : `Save failed (${res.status})`,
      );
      return null;
    }
    return (await res.json()) as ClinicSettingsRow;
  }

  function syncProvidersFromRow(row: ClinicSettingsRow) {
    if (row.providers !== undefined) {
      setProviders(parseProviders(row.providers));
    }
  }

  function flashSaved(setter: (v: boolean) => void) {
    setter(true);
    window.setTimeout(() => setter(false), 2000);
  }

  async function handleSaveClinicInfo() {
    if (!clinicInfoBaseline) return;
    const changed = pickChangedClinicFields(clinicInfo, clinicInfoBaseline);
    if (Object.keys(changed).length === 0) return;
    setSavingClinic(true);
    try {
      const updated = await patchBody(changed);
      if (updated) {
        setClinicInfoBaseline({ ...clinicInfo });
        syncProvidersFromRow(updated);
        flashSaved(setClinicSavedMsg);
      }
    } finally {
      setSavingClinic(false);
    }
  }

  async function handleSaveHours() {
    const payload: Record<string, DayHours> = {};
    for (const { key } of DAY_DEFS) {
      payload[key] = { ...hours[key] };
    }
    setSavingHours(true);
    try {
      const updated = await patchBody({ business_hours: payload });
      if (updated) {
        setHoursBaseline(JSON.parse(JSON.stringify(hours)) as Record<DayKey, DayHours>);
        syncProvidersFromRow(updated);
        flashSaved(setHoursSavedMsg);
      }
    } finally {
      setSavingHours(false);
    }
  }

  async function handleSaveBilling() {
    setSavingBilling(true);
    try {
      const updated = await patchBody({ billing_model: billingModel });
      if (updated) {
        setBillingBaseline(billingModel);
        syncProvidersFromRow(updated);
        flashSaved(setBillingSavedMsg);
      }
    } finally {
      setSavingBilling(false);
    }
  }

  async function handleSaveTimezone() {
    setSavingTz(true);
    try {
      const updated = await patchBody({ timezone });
      if (updated) {
        setTimezoneBaseline(timezone);
        syncProvidersFromRow(updated);
        flashSaved(setTzSavedMsg);
      }
    } finally {
      setSavingTz(false);
    }
  }

  function openAddProvider() {
    setProviderEditor({ open: true, mode: "add", id: crypto.randomUUID() });
    setEditorName("");
    setEditorSpecialty("");
    setEditorColor(DEFAULT_PROVIDER_COLOR);
    setSectionError(null);
  }

  function openEditProvider(p: ProviderRow) {
    setProviderEditor({ open: true, mode: "edit", id: p.id });
    setEditorName(p.name === "—" ? "" : p.name);
    setEditorSpecialty(p.specialty === "—" ? "" : p.specialty);
    setEditorColor(p.color);
    setSectionError(null);
  }

  function closeProviderEditor() {
    setProviderEditor({ open: false });
  }

  async function saveProviderEditor() {
    if (!providerEditor.open) return;
    const nameTrim = editorName.trim();
    if (!nameTrim) {
      setSectionError("Provider name is required.");
      return;
    }
    const color = normalizeHexColor(editorColor);
    const specialty = editorSpecialty.trim();
    setSavingProviders(true);
    setSectionError(null);
    try {
      let next: ProviderRow[];
      if (providerEditor.mode === "add") {
        next = [
          ...providers,
          {
            id: providerEditor.id,
            name: nameTrim,
            specialty,
            color,
          },
        ];
      } else {
        next = providers.map((p) =>
          p.id === providerEditor.id
            ? { ...p, name: nameTrim, specialty, color }
            : p,
        );
      }
      const updated = await patchBody({
        providers: providersToPayload(next),
      });
      if (updated) {
        syncProvidersFromRow(updated);
        closeProviderEditor();
        flashSaved(setProvidersSavedMsg);
      }
    } finally {
      setSavingProviders(false);
    }
  }

  function confirmRemoveProvider(p: ProviderRow) {
    const ok = window.confirm(
      "Are you sure you want to remove this provider?",
    );
    if (!ok) return;
    void removeProvider(p.id);
  }

  async function removeProvider(id: string) {
    setSavingProviders(true);
    setSectionError(null);
    try {
      const next = providers.filter((p) => p.id !== id);
      const updated = await patchBody({
        providers: providersToPayload(next),
      });
      if (updated) {
        syncProvidersFromRow(updated);
        flashSaved(setProvidersSavedMsg);
      }
    } finally {
      setSavingProviders(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <div
          className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-[#16A34A]"
          aria-hidden
        />
        <p className="text-sm text-gray-500">Loading settings…</p>
      </div>
    );
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <h1 className={DS_PAGE_TITLE}>Settings</h1>
      <p className={DS_PAGE_SUBTITLE}>
        Clinic configuration and preferences
      </p>

      {fetchError ? (
        <p className="mb-6 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}

      {sectionError ? (
        <p className="mb-6 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {sectionError}
        </p>
      ) : null}

      {/* Section 1 — Clinic Information */}
      <section className={`${DS_CARD} mb-8`}>
        <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
          Clinic Information
        </h2>
        <div className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Clinic Name
            </label>
            <input
              type="text"
              className={INPUT_CLASS}
              value={clinicInfo.clinic_name}
              onChange={(e) =>
                setClinicInfo((s) => ({ ...s, clinic_name: e.target.value }))
              }
              disabled={!clinicInfoBaseline}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Phone
              </label>
              <input
                type="text"
                className={INPUT_CLASS}
                value={clinicInfo.phone}
                onChange={(e) => setClinicInfo((s) => ({ ...s, phone: e.target.value }))}
                disabled={!clinicInfoBaseline}
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Email
              </label>
              <input
                type="email"
                className={INPUT_CLASS}
                value={clinicInfo.email}
                onChange={(e) => setClinicInfo((s) => ({ ...s, email: e.target.value }))}
                disabled={!clinicInfoBaseline}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Address Line 1
            </label>
            <input
              type="text"
              className={INPUT_CLASS}
              value={clinicInfo.address_line1}
              onChange={(e) =>
                setClinicInfo((s) => ({ ...s, address_line1: e.target.value }))
              }
              disabled={!clinicInfoBaseline}
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Address Line 2
            </label>
            <input
              type="text"
              className={INPUT_CLASS}
              value={clinicInfo.address_line2}
              onChange={(e) =>
                setClinicInfo((s) => ({ ...s, address_line2: e.target.value }))
              }
              disabled={!clinicInfoBaseline}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                City
              </label>
              <input
                type="text"
                className={INPUT_CLASS}
                value={clinicInfo.city}
                onChange={(e) => setClinicInfo((s) => ({ ...s, city: e.target.value }))}
                disabled={!clinicInfoBaseline}
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                State
              </label>
              <input
                type="text"
                className={INPUT_CLASS}
                value={clinicInfo.state}
                onChange={(e) => setClinicInfo((s) => ({ ...s, state: e.target.value }))}
                disabled={!clinicInfoBaseline}
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                ZIP
              </label>
              <input
                type="text"
                className={INPUT_CLASS}
                value={clinicInfo.zip}
                onChange={(e) => setClinicInfo((s) => ({ ...s, zip: e.target.value }))}
                disabled={!clinicInfoBaseline}
              />
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            disabled={!clinicInfoBaseline || savingClinic || !clinicInfoDirty}
            onClick={() => void handleSaveClinicInfo()}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {savingClinic ? "Saving…" : "Save Clinic Info"}
          </button>
          {clinicSavedMsg ? (
            <span className="text-sm font-medium text-green-600">Saved</span>
          ) : null}
        </div>
      </section>

      {/* Section 2 — Business Hours */}
      <section className={`${DS_CARD} mb-8`}>
        <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
          Business Hours
        </h2>
        <div className="mt-6 space-y-3">
          {DAY_DEFS.map(({ key, label }) => {
            const row = hours[key];
            return (
              <div
                key={key}
                className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-[7rem] items-center gap-3">
                  <input
                    id={`day-${key}`}
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) =>
                      setHours((h) => ({
                        ...h,
                        [key]: { ...h[key], enabled: e.target.checked },
                      }))
                    }
                    disabled={!hoursBaseline}
                    className="h-4 w-4 rounded border-gray-300 text-[#16A34A] focus:ring-green-500"
                  />
                  <label
                    htmlFor={`day-${key}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    {label}
                  </label>
                </div>
                {row.enabled ? (
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <input
                      type="time"
                      className={`${INPUT_CLASS} mt-0 w-36 sm:w-32`}
                      value={row.open}
                      onChange={(e) =>
                        setHours((h) => ({
                          ...h,
                          [key]: { ...h[key], open: e.target.value },
                        }))
                      }
                      disabled={!hoursBaseline}
                    />
                    <span className="text-xs text-gray-400">to</span>
                    <input
                      type="time"
                      className={`${INPUT_CLASS} mt-0 w-36 sm:w-32`}
                      value={row.close}
                      onChange={(e) =>
                        setHours((h) => ({
                          ...h,
                          [key]: { ...h[key], close: e.target.value },
                        }))
                      }
                      disabled={!hoursBaseline}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 sm:text-right">Closed</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            disabled={!hoursBaseline || savingHours || !hoursDirty}
            onClick={() => void handleSaveHours()}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {savingHours ? "Saving…" : "Save Hours"}
          </button>
          {hoursSavedMsg ? (
            <span className="text-sm font-medium text-green-600">Saved</span>
          ) : null}
        </div>
      </section>

      {/* Section 3 — Billing Model */}
      <section className={`${DS_CARD} mb-8`}>
        <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
          Billing Model
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {BILLING_OPTIONS.map((opt) => {
            const active = billingModel === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={!billingBaseline}
                onClick={() => setBillingModel(opt.id)}
                className={[
                  "relative rounded-xl border p-4 text-left transition-colors",
                  active
                    ? "border-[#16A34A] bg-green-50/40 ring-1 ring-[#16A34A]/30"
                    : "border-gray-100 bg-white hover:border-gray-200",
                ].join(" ")}
              >
                {active ? (
                  <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[#16A34A] text-white">
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </span>
                ) : null}
                <p className="pr-8 text-sm font-semibold text-gray-900">{opt.title}</p>
                <p className="mt-1 text-xs text-gray-500">{opt.subtitle}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            disabled={!billingBaseline || savingBilling || !billingDirty}
            onClick={() => void handleSaveBilling()}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {savingBilling ? "Saving…" : "Save Billing Model"}
          </button>
          {billingSavedMsg ? (
            <span className="text-sm font-medium text-green-600">Saved</span>
          ) : null}
        </div>
      </section>

      {/* Section 4 — Providers */}
      <section className={`${DS_CARD} mb-8`}>
        <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
          Providers
        </h2>
        <ul className="mt-6 divide-y divide-gray-100">
          {providers.length === 0 ? (
            <li className="py-4 text-sm text-gray-500">No providers listed.</li>
          ) : (
            providers.map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-gray-200"
                    style={{ backgroundColor: p.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.specialty}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                  <button
                    type="button"
                    disabled={!clinicInfoBaseline || savingProviders}
                    onClick={() => openEditProvider(p)}
                    className="rounded-xl border border-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={!clinicInfoBaseline || savingProviders}
                    onClick={() => confirmRemoveProvider(p)}
                    className="rounded-xl border border-red-100 bg-red-50/50 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:border-red-200 hover:bg-red-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            disabled={!clinicInfoBaseline || savingProviders}
            onClick={() => openAddProvider()}
            className="rounded-xl border border-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900 disabled:opacity-50"
          >
            + Add Provider
          </button>
          {providersSavedMsg ? (
            <span className="text-sm font-medium text-green-600">Saved</span>
          ) : null}
        </div>
      </section>

      {providerEditor.open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !savingProviders) {
              closeProviderEditor();
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="provider-editor-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3
              id="provider-editor-title"
              className="text-lg font-semibold text-gray-900"
            >
              {providerEditor.mode === "add" ? "Add provider" : "Edit provider"}
            </h3>
            <div className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="provider-name"
                  className="text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Name
                </label>
                <input
                  id="provider-name"
                  type="text"
                  className={INPUT_CLASS}
                  value={editorName}
                  onChange={(e) => setEditorName(e.target.value)}
                  disabled={savingProviders}
                  autoComplete="off"
                />
              </div>
              <div>
                <label
                  htmlFor="provider-specialty"
                  className="text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  Specialty
                </label>
                <input
                  id="provider-specialty"
                  type="text"
                  className={INPUT_CLASS}
                  value={editorSpecialty}
                  onChange={(e) => setEditorSpecialty(e.target.value)}
                  disabled={savingProviders}
                  autoComplete="off"
                />
              </div>
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Color
                </span>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span
                    className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 shadow-inner"
                    style={{
                      backgroundColor: normalizeHexColor(editorColor),
                    }}
                    aria-hidden
                  />
                  <input
                    type="color"
                    className="h-10 w-14 cursor-pointer rounded-lg border border-gray-100 bg-white p-0.5"
                    value={normalizeHexColor(editorColor)}
                    onChange={(e) => setEditorColor(e.target.value.toUpperCase())}
                    disabled={savingProviders}
                    aria-label="Pick color"
                  />
                  <input
                    type="text"
                    className={`${INPUT_CLASS} mt-0 max-w-[9rem]`}
                    value={editorColor}
                    onChange={(e) => setEditorColor(e.target.value)}
                    onBlur={() =>
                      setEditorColor(normalizeHexColor(editorColor))
                    }
                    disabled={savingProviders}
                    placeholder="#1A6B8A"
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-gray-100 pt-5">
              <button
                type="button"
                disabled={savingProviders}
                onClick={() => void saveProviderEditor()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
              >
                {savingProviders ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={savingProviders}
                onClick={closeProviderEditor}
                className="rounded-xl border border-gray-100 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Section 5 — Timezone */}
      <section className={`${DS_CARD} mb-8`}>
        <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
          Timezone
        </h2>
        <div className="mt-6 max-w-md">
          <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Clinic timezone
          </label>
          <select
            className={SELECT_CLASS}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            disabled={!timezoneBaseline}
          >
            {TIMEZONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value} ({o.label})
              </option>
            ))}
          </select>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            disabled={!timezoneBaseline || savingTz || !tzDirty}
            onClick={() => void handleSaveTimezone()}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {savingTz ? "Saving…" : "Save Timezone"}
          </button>
          {tzSavedMsg ? (
            <span className="text-sm font-medium text-green-600">Saved</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

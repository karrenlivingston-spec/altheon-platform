"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import { FeeScheduleManager } from "@/components/admin/FeeScheduleManager";
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";

const INPUT_CLASS = `mt-1 block h-9 w-full ${DS_INPUT}`;
const LABEL_CLASS = "block text-xs font-medium uppercase tracking-wide text-gray-500";

type ClinicListRow = {
  id: string;
  brand_name?: string | null;
  slug?: string | null;
  agent_name?: string | null;
  primary_color?: string | null;
  logo_url?: string | null;
  billing_model?: string | null;
  created_at?: string | null;
};

type BillingModelApi = "cash" | "insurance" | "hybrid";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function slugFromBrandName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeHexColor(s: string): string {
  const t = s.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t;
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t}`;
  return "#16A34A";
}

function displayBillingModel(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const s = String(raw).trim().toLowerCase();
  if (s === "cash") return "Cash";
  if (s === "insurance") return "Insurance";
  if (s === "hybrid") return "Hybrid";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function buildOnboardBody(values: {
  brand_name: string;
  slug: string;
  agent_name: string;
  primary_color: string;
  logo_url: string;
  billing_model: BillingModelApi;
  admin_email: string;
  admin_password: string;
}) {
  const brand = values.brand_name.trim();
  const slug = values.slug.trim().toLowerCase();
  const adminEmail = values.admin_email.trim().toLowerCase();
  const provisionId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
    : String(Date.now());

  return {
    clinic: {
      name: brand,
      slug,
      brand_name: brand,
      primary_color: normalizeHexColor(values.primary_color),
      agent_name: values.agent_name.trim() || "Aria",
      billing_model: values.billing_model,
    },
    location: {
      name: `${brand} Main Office`,
      address_line1: "Pending setup",
      city: "Atlanta",
      state: "GA",
      zip: "30301",
      phone: "5555550100",
      email: adminEmail,
      timezone: "America/New_York",
    },
    clinicians: [
      {
        first_name: "Pending",
        last_name: "Provider",
        title: "",
        email: `clinician.${provisionId}.${slug.slice(0, 24)}@clinic-provision.local`,
        specialty: "",
        color: "#0EA5A4",
      },
    ],
    admin_user: {
      email: adminEmail,
      password: values.admin_password,
    },
  };
}

export default function AdminClinicsPage() {
  const router = useRouter();
  const { role, loading: clinicCtxLoading } = useClinic();

  const [rows, setRows] = useState<ClinicListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [newPhase, setNewPhase] = useState<"form" | "fee-schedule">("form");
  const [feeClinicId, setFeeClinicId] = useState("");
  const [feeToken, setFeeToken] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicListRow | null>(null);

  const [newBrand, setNewBrand] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [newAgent, setNewAgent] = useState("Aria");
  const [newColor, setNewColor] = useState("#16A34A");
  const [newLogoUrl, setNewLogoUrl] = useState("");
  const [newBilling, setNewBilling] = useState<BillingModelApi>("cash");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [newSubmitError, setNewSubmitError] = useState<string | null>(null);
  const [newBusy, setNewBusy] = useState(false);

  const [editBrand, setEditBrand] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editSlugTouched, setEditSlugTouched] = useState(false);
  const [editAgent, setEditAgent] = useState("");
  const [editColor, setEditColor] = useState("#16A34A");
  const [editLogoUrl, setEditLogoUrl] = useState("");
  const [editBilling, setEditBilling] = useState<BillingModelApi>("cash");
  const [editSubmitError, setEditSubmitError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const fetchClinics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/clinics`, {
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setError(t.trim() || `Request failed (${res.status})`);
        setRows([]);
        return;
      }
      const data = (await res.json()) as unknown;
      setRows(Array.isArray(data) ? (data as ClinicListRow[]) : []);
    } catch {
      setError("Could not load clinics.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clinicCtxLoading || role !== "super_admin") return;
    void fetchClinics();
  }, [role, clinicCtxLoading, fetchClinics]);

  useEffect(() => {
    if (!clinicCtxLoading && role !== "super_admin") {
      router.replace("/admin");
    }
  }, [clinicCtxLoading, role, router]);

  useEffect(() => {
    if (!newOpen || slugTouched) return;
    setNewSlug(slugFromBrandName(newBrand));
  }, [newBrand, newOpen, slugTouched]);

  useEffect(() => {
    if (!editOpen || editSlugTouched || !editing) return;
    setEditSlug(slugFromBrandName(editBrand));
  }, [editBrand, editOpen, editSlugTouched, editing]);

  function openEdit(row: ClinicListRow) {
    setEditing(row);
    setEditBrand(row.brand_name?.trim() ?? "");
    setEditSlug(row.slug?.trim() ?? "");
    setEditSlugTouched(true);
    setEditAgent(row.agent_name?.trim() || "Aria");
    setEditColor(normalizeHexColor(row.primary_color ?? "#16A34A"));
    setEditLogoUrl(row.logo_url?.trim() ?? "");
    const bm = (row.billing_model ?? "cash").toLowerCase();
    setEditBilling(
      bm === "insurance" || bm === "hybrid" ? bm : "cash",
    );
    setEditSubmitError(null);
    setEditOpen(true);
  }

  function resetNewForm() {
    setNewBrand("");
    setNewSlug("");
    setSlugTouched(false);
    setNewAgent("Aria");
    setNewColor("#16A34A");
    setNewLogoUrl("");
    setNewBilling("cash");
    setNewAdminEmail("");
    setNewAdminPassword("");
    setNewSubmitError(null);
    setNewPhase("form");
    setFeeClinicId("");
    setFeeToken("");
  }

  function closeNewClinicModal() {
    setNewOpen(false);
    resetNewForm();
  }

  async function beginFeeScheduleStep(createdId: string) {
    setFeeClinicId(createdId);
    setNewPhase("fee-schedule");
    const email = newAdminEmail.trim().toLowerCase();
    const password = newAdminPassword;
    if (email && password.length >= 8) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error && data.session?.access_token) {
        setFeeToken(data.session.access_token);
        return;
      }
    }
    const { data } = await supabase.auth.getSession();
    setFeeToken(data.session?.access_token ?? "");
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    setNewSubmitError(null);
    const brand = newBrand.trim();
    const slug = newSlug.trim().toLowerCase();
    if (!brand || !slug) {
      setNewSubmitError("Brand name and slug are required.");
      return;
    }
    if (!newAdminEmail.trim() || newAdminPassword.length < 8) {
      setNewSubmitError(
        "Administrator email and password (min 8 characters) are required to provision the clinic.",
      );
      return;
    }
    setNewBusy(true);
    try {
      const body = buildOnboardBody({
        brand_name: brand,
        slug,
        agent_name: newAgent,
        primary_color: newColor,
        logo_url: newLogoUrl,
        billing_model: newBilling,
        admin_email: newAdminEmail,
        admin_password: newAdminPassword,
      });
      const res = await fetch(`${API_BASE}/clinics/onboard`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        detail?: string;
        clinic_id?: string;
      };
      if (!res.ok) {
        setNewSubmitError(
          typeof json.detail === "string"
            ? json.detail
            : `Could not create clinic (${res.status})`,
        );
        return;
      }
      const createdId = json.clinic_id;
      if (createdId && newLogoUrl.trim()) {
        const patchRes = await fetch(
          `${API_BASE}/clinics/${encodeURIComponent(createdId)}`,
          {
            method: "PATCH",
            headers: await authHeaders(),
            body: JSON.stringify({ logo_url: newLogoUrl.trim() }),
          },
        );
        if (!patchRes.ok) {
          const pj = (await patchRes.json().catch(() => ({}))) as {
            detail?: string;
          };
          setNewSubmitError(
            typeof pj.detail === "string"
              ? pj.detail
              : "Clinic created but logo could not be saved.",
          );
          if (createdId) {
            await beginFeeScheduleStep(createdId);
          } else {
            closeNewClinicModal();
          }
          await fetchClinics();
          return;
        }
      }
      if (createdId) {
        await beginFeeScheduleStep(createdId);
      } else {
        closeNewClinicModal();
      }
      await fetchClinics();
    } catch {
      setNewSubmitError("Request failed.");
    } finally {
      setNewBusy(false);
    }
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing?.id) return;
    setEditSubmitError(null);
    const brand = editBrand.trim();
    const slug = editSlug.trim().toLowerCase();
    if (!brand || !slug) {
      setEditSubmitError("Brand name and slug are required.");
      return;
    }
    setEditBusy(true);
    try {
      const patch: Record<string, unknown> = {
        brand_name: brand,
        slug,
        agent_name: editAgent.trim() || "Aria",
        primary_color: normalizeHexColor(editColor),
        billing_model: editBilling,
      };
      if (editLogoUrl.trim()) {
        patch.logo_url = editLogoUrl.trim();
      } else {
        patch.logo_url = null;
      }
      const res = await fetch(
        `${API_BASE}/clinics/${encodeURIComponent(editing.id)}`,
        {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify(patch),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setEditSubmitError(
          typeof json.detail === "string"
            ? json.detail
            : `Could not update clinic (${res.status})`,
        );
        return;
      }
      setEditOpen(false);
      setEditing(null);
      await fetchClinics();
    } catch {
      setEditSubmitError("Request failed.");
    } finally {
      setEditBusy(false);
    }
  }

  const headerRight = useMemo(
    () => (
      <button
        type="button"
        className={DS_PRIMARY_BTN}
        onClick={() => {
          resetNewForm();
          setNewOpen(true);
        }}
      >
        New Clinic
      </button>
    ),
    [],
  );

  if (clinicCtxLoading) {
    return (
      <div className={`${DS_PAGE_ROOT} flex min-h-[40vh] items-center justify-center`}>
        <div className="flex flex-col items-center gap-3 text-sm text-gray-500">
          <span
            className="inline-block size-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#16A34A]"
            aria-hidden
          />
          Loading…
        </div>
      </div>
    );
  }

  if (role !== "super_admin") {
    return (
      <div className={`${DS_PAGE_ROOT} flex min-h-[30vh] items-center justify-center`}>
        <p className="text-sm text-gray-500">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Clinics</h1>
        </div>
        <div className="shrink-0">{headerRight}</div>
      </div>

      {error ? (
        <div className="mb-6 rounded-[14px] border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <button
              type="button"
              className={DS_SECONDARY_BTN}
              onClick={() => void fetchClinics()}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      <div className={DS_TABLE_WRAP}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Brand Name</th>
                <th className={DS_TH}>Slug</th>
                <th className={DS_TH}>Agent Name</th>
                <th className={DS_TH}>Billing Model</th>
                <th className={DS_TH}>Primary Color</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className={DS_TD_PRIMARY} colSpan={6}>
                    <div className="flex items-center justify-center gap-3 py-16 text-gray-500">
                      <span
                        className="inline-block size-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#16A34A]"
                        aria-hidden
                      />
                      Loading clinics…
                    </div>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-gray-500"
                    colSpan={6}
                  >
                    No clinics found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className={DS_TR}>
                    <td className={DS_TD_PRIMARY}>{row.brand_name ?? "—"}</td>
                    <td className={DS_TD_PRIMARY}>{row.slug ?? "—"}</td>
                    <td className={DS_TD_PRIMARY}>{row.agent_name ?? "—"}</td>
                    <td className={DS_TD_PRIMARY}>
                      {displayBillingModel(row.billing_model)}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-5 w-5 shrink-0 rounded-full border border-gray-200 shadow-inner"
                          style={{
                            backgroundColor: normalizeHexColor(
                              row.primary_color ?? "#16A34A",
                            ),
                          }}
                          aria-hidden
                        />
                        <span className="font-mono text-xs text-gray-700">
                          {normalizeHexColor(row.primary_color ?? "#16A34A")}
                        </span>
                      </div>
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <button
                        type="button"
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
                        onClick={() => openEdit(row)}
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

      {newOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !newBusy) closeNewClinicModal();
          }}
        >
          <div
            className={[
              "max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-lg",
              newPhase === "fee-schedule" ? "max-w-4xl" : "max-w-lg",
            ].join(" ")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-clinic-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {newPhase === "fee-schedule" ? (
              <>
                <h2
                  id="new-clinic-title"
                  className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
                >
                  Fee Schedule (Optional)
                </h2>
                <p className="mt-3 text-sm text-gray-600">
                  You can upload this clinic&apos;s fee schedule now or skip — it
                  can be configured later in Settings.
                </p>
                <div className="mt-6">
                  <FeeScheduleManager
                    clinicId={feeClinicId}
                    token={feeToken}
                  />
                </div>
                <div className="mt-6 flex justify-end border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    className={DS_PRIMARY_BTN}
                    onClick={() => closeNewClinicModal()}
                  >
                    Skip for now
                  </button>
                </div>
              </>
            ) : (
              <>
            <h2
              id="new-clinic-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              New clinic
            </h2>
            <form className="mt-5 space-y-4" onSubmit={submitNew}>
              <div>
                <label htmlFor="nc-brand" className={LABEL_CLASS}>
                  Brand name
                </label>
                <input
                  id="nc-brand"
                  className={INPUT_CLASS}
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  required
                  autoComplete="off"
                  disabled={newBusy}
                />
              </div>
              <div>
                <label htmlFor="nc-slug" className={LABEL_CLASS}>
                  Slug
                </label>
                <input
                  id="nc-slug"
                  className={INPUT_CLASS}
                  value={newSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setNewSlug(e.target.value);
                  }}
                  required
                  autoComplete="off"
                  disabled={newBusy}
                />
              </div>
              <div>
                <label htmlFor="nc-agent" className={LABEL_CLASS}>
                  Agent name
                </label>
                <input
                  id="nc-agent"
                  className={INPUT_CLASS}
                  value={newAgent}
                  onChange={(e) => setNewAgent(e.target.value)}
                  required
                  autoComplete="off"
                  disabled={newBusy}
                />
              </div>
              <div>
                <span className={LABEL_CLASS}>Primary color</span>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-14 cursor-pointer rounded border border-gray-200 bg-white"
                    value={normalizeHexColor(newColor)}
                    onChange={(e) => setNewColor(e.target.value)}
                    disabled={newBusy}
                    aria-label="Pick primary color"
                  />
                  <input
                    className={`${INPUT_CLASS} flex-1 min-w-[8rem] font-mono text-sm`}
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    disabled={newBusy}
                    placeholder="#16A34A"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="nc-logo" className={LABEL_CLASS}>
                  Logo URL (optional)
                </label>
                <input
                  id="nc-logo"
                  type="url"
                  className={INPUT_CLASS}
                  value={newLogoUrl}
                  onChange={(e) => setNewLogoUrl(e.target.value)}
                  autoComplete="off"
                  disabled={newBusy}
                />
              </div>
              <div>
                <label htmlFor="nc-billing" className={LABEL_CLASS}>
                  Billing model
                </label>
                <select
                  id="nc-billing"
                  className={INPUT_CLASS}
                  value={newBilling}
                  onChange={(e) =>
                    setNewBilling(e.target.value as BillingModelApi)
                  }
                  disabled={newBusy}
                >
                  <option value="cash">Cash</option>
                  <option value="insurance">Insurance</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-medium text-gray-700">
                  Clinic administrator
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Required for provisioning: creates the initial admin login for
                  this clinic (same as POST /clinics/onboard).
                </p>
                <div className="mt-3 space-y-3">
                  <div>
                    <label htmlFor="nc-admin-email" className={LABEL_CLASS}>
                      Admin email
                    </label>
                    <input
                      id="nc-admin-email"
                      type="email"
                      className={INPUT_CLASS}
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      autoComplete="off"
                      disabled={newBusy}
                    />
                  </div>
                  <div>
                    <label htmlFor="nc-admin-pass" className={LABEL_CLASS}>
                      Admin password (min 8 characters)
                    </label>
                    <input
                      id="nc-admin-pass"
                      type="password"
                      className={INPUT_CLASS}
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      autoComplete="new-password"
                      disabled={newBusy}
                    />
                  </div>
                </div>
              </div>

              {newSubmitError ? (
                <p className="text-sm text-red-600">{newSubmitError}</p>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  disabled={newBusy}
                  onClick={() => closeNewClinicModal()}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
                  disabled={newBusy}
                >
                  {newBusy ? "Creating…" : "Create clinic"}
                </button>
              </div>
            </form>
              </>
            )}
          </div>
        </div>
      ) : null}

      {editOpen && editing ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !editBusy) setEditOpen(false);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-clinic-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2
              id="edit-clinic-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              Edit clinic
            </h2>
            <form className="mt-5 space-y-4" onSubmit={submitEdit}>
              <div>
                <label htmlFor="ec-brand" className={LABEL_CLASS}>
                  Brand name
                </label>
                <input
                  id="ec-brand"
                  className={INPUT_CLASS}
                  value={editBrand}
                  onChange={(e) => setEditBrand(e.target.value)}
                  required
                  disabled={editBusy}
                />
              </div>
              <div>
                <label htmlFor="ec-slug" className={LABEL_CLASS}>
                  Slug
                </label>
                <input
                  id="ec-slug"
                  className={INPUT_CLASS}
                  value={editSlug}
                  onChange={(e) => {
                    setEditSlugTouched(true);
                    setEditSlug(e.target.value);
                  }}
                  required
                  disabled={editBusy}
                />
              </div>
              <div>
                <label htmlFor="ec-agent" className={LABEL_CLASS}>
                  Agent name
                </label>
                <input
                  id="ec-agent"
                  className={INPUT_CLASS}
                  value={editAgent}
                  onChange={(e) => setEditAgent(e.target.value)}
                  required
                  disabled={editBusy}
                />
              </div>
              <div>
                <span className={LABEL_CLASS}>Primary color</span>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-14 cursor-pointer rounded border border-gray-200 bg-white"
                    value={normalizeHexColor(editColor)}
                    onChange={(e) => setEditColor(e.target.value)}
                    disabled={editBusy}
                    aria-label="Pick primary color"
                  />
                  <input
                    className={`${INPUT_CLASS} flex-1 min-w-[8rem] font-mono text-sm`}
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    disabled={editBusy}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ec-logo" className={LABEL_CLASS}>
                  Logo URL (optional)
                </label>
                <input
                  id="ec-logo"
                  type="url"
                  className={INPUT_CLASS}
                  value={editLogoUrl}
                  onChange={(e) => setEditLogoUrl(e.target.value)}
                  disabled={editBusy}
                />
              </div>
              <div>
                <label htmlFor="ec-billing" className={LABEL_CLASS}>
                  Billing model
                </label>
                <select
                  id="ec-billing"
                  className={INPUT_CLASS}
                  value={editBilling}
                  onChange={(e) =>
                    setEditBilling(e.target.value as BillingModelApi)
                  }
                  disabled={editBusy}
                >
                  <option value="cash">Cash</option>
                  <option value="insurance">Insurance</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>

              {editSubmitError ? (
                <p className="text-sm text-red-600">{editSubmitError}</p>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  disabled={editBusy}
                  onClick={() => setEditOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
                  disabled={editBusy}
                >
                  {editBusy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

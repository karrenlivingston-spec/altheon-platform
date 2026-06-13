"use client";

import { useEffect, useState } from "react";

import {
  DS_INPUT,
  DS_PRIMARY_BTN,
} from "@/app/admin/designSystem";
import { FeeScheduleManager } from "@/components/admin/FeeScheduleManager";

const INPUT_CLASS = `mt-1 block h-9 w-full ${DS_INPUT}`;
const LABEL_CLASS = "block text-xs font-medium uppercase tracking-wide text-gray-500";

export type BillingModelApi = "cash" | "insurance" | "hybrid";

export type ClinicEditTarget = {
  id: string;
  brand_name?: string | null;
  name?: string | null;
  slug?: string | null;
  agent_name?: string | null;
  primary_color?: string | null;
  logo_url?: string | null;
  billing_model?: string | null;
};

export function normalizeHexColor(s: string): string {
  const t = s.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t;
  if (/^[0-9A-Fa-f]{6}$/.test(t)) return `#${t}`;
  return "#16A34A";
}

export function slugFromBrandName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildOnboardBody(values: {
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
  const provisionId =
    typeof crypto !== "undefined" && crypto.randomUUID
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

type NewClinicModalProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: {
    brand_name: string;
    slug: string;
    agent_name: string;
    primary_color: string;
    logo_url: string;
    billing_model: BillingModelApi;
    admin_email: string;
    admin_password: string;
  }) => void;
  phase: "form" | "fee-schedule";
  feeClinicId: string;
  feeToken: string;
};

export function NewClinicModal({
  open,
  busy,
  error,
  onClose,
  onSubmit,
  phase,
  feeClinicId,
  feeToken,
}: NewClinicModalProps) {
  const [brand, setBrand] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [agent, setAgent] = useState("Aria");
  const [color, setColor] = useState("#16A34A");
  const [logoUrl, setLogoUrl] = useState("");
  const [billing, setBilling] = useState<BillingModelApi>("cash");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setBrand("");
      setSlug("");
      setSlugTouched(false);
      setAgent("Aria");
      setColor("#16A34A");
      setLogoUrl("");
      setBilling("cash");
      setAdminEmail("");
      setAdminPassword("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || slugTouched) return;
    setSlug(slugFromBrandName(brand));
  }, [brand, open, slugTouched]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className={[
          "max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-lg",
          phase === "fee-schedule" ? "max-w-4xl" : "max-w-lg",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {phase === "fee-schedule" ? (
          <>
            <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
              Fee Schedule (Optional)
            </h2>
            <p className="mt-3 text-sm text-gray-600">
              Upload this clinic&apos;s fee schedule now or skip — it can be configured
              later in Settings.
            </p>
            <div className="mt-6">
              <FeeScheduleManager clinicId={feeClinicId} token={feeToken} />
            </div>
            <div className="mt-6 flex justify-end border-t border-gray-100 pt-4">
              <button type="button" className={DS_PRIMARY_BTN} onClick={onClose}>
                Skip for now
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                brand_name: brand,
                slug,
                agent_name: agent,
                primary_color: color,
                logo_url: logoUrl,
                billing_model: billing,
                admin_email: adminEmail,
                admin_password: adminPassword,
              });
            }}
          >
            <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
              New clinic
            </h2>
            <div className="mt-5 space-y-4">
              <div>
                <label className={LABEL_CLASS}>Brand name</label>
                <input
                  className={INPUT_CLASS}
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  required
                  disabled={busy}
                  name="brand_name"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Slug</label>
                <input
                  className={INPUT_CLASS}
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value);
                  }}
                  required
                  disabled={busy}
                  name="slug"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Agent name</label>
                <input
                  className={INPUT_CLASS}
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  required
                  disabled={busy}
                  name="agent_name"
                />
              </div>
              <div>
                <span className={LABEL_CLASS}>Primary color</span>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-14 cursor-pointer rounded border border-gray-200"
                    value={normalizeHexColor(color)}
                    onChange={(e) => setColor(e.target.value)}
                    disabled={busy}
                  />
                  <input
                    className={`${INPUT_CLASS} font-mono text-sm`}
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    disabled={busy}
                    name="primary_color"
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLASS}>Logo URL (optional)</label>
                <input
                  type="url"
                  className={INPUT_CLASS}
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  disabled={busy}
                  name="logo_url"
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Billing model</label>
                <select
                  className={INPUT_CLASS}
                  value={billing}
                  onChange={(e) => setBilling(e.target.value as BillingModelApi)}
                  disabled={busy}
                  name="billing_model"
                >
                  <option value="cash">Cash</option>
                  <option value="insurance">Insurance</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-medium text-gray-700">Clinic administrator</p>
                <div className="mt-3 space-y-3">
                  <input
                    type="email"
                    className={INPUT_CLASS}
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    disabled={busy}
                    name="admin_email"
                    placeholder="Admin email"
                  />
                  <input
                    type="password"
                    className={INPUT_CLASS}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    disabled={busy}
                    name="admin_password"
                    placeholder="Password (min 8 chars)"
                  />
                </div>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  disabled={busy}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button type="submit" className={DS_PRIMARY_BTN} disabled={busy}>
                  {busy ? "Creating…" : "Create clinic"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

type EditClinicModalProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  target: ClinicEditTarget | null;
  onClose: () => void;
  onSubmit: (values: {
    brand_name: string;
    slug: string;
    agent_name: string;
    primary_color: string;
    logo_url: string;
    billing_model: BillingModelApi;
  }) => void;
};

export function EditClinicModal({
  open,
  busy,
  error,
  target,
  onClose,
  onSubmit,
}: EditClinicModalProps) {
  const [brand, setBrand] = useState("");
  const [slug, setSlug] = useState("");
  const [agent, setAgent] = useState("Aria");
  const [color, setColor] = useState("#16A34A");
  const [logoUrl, setLogoUrl] = useState("");
  const [billing, setBilling] = useState<BillingModelApi>("cash");

  useEffect(() => {
    if (!target || !open) return;
    setBrand(target.brand_name?.trim() || target.name?.trim() || "");
    setSlug(target.slug?.trim() || "");
    setAgent(target.agent_name?.trim() || "Aria");
    setColor(normalizeHexColor(target.primary_color ?? "#16A34A"));
    setLogoUrl(target.logo_url?.trim() ?? "");
    const bm = (target.billing_model ?? "cash").toLowerCase();
    setBilling(bm === "insurance" || bm === "hybrid" ? bm : "cash");
  }, [target, open]);

  if (!open || !target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              brand_name: brand,
              slug,
              agent_name: agent,
              primary_color: color,
              logo_url: logoUrl,
              billing_model: billing,
            });
          }}
        >
          <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
            Edit clinic
          </h2>
          <div className="mt-5 space-y-4">
            <div>
              <label className={LABEL_CLASS}>Brand name</label>
              <input
                className={INPUT_CLASS}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                required
                disabled={busy}
                name="edit_brand_name"
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Slug</label>
              <input
                className={INPUT_CLASS}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
                disabled={busy}
                name="edit_slug"
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Agent name</label>
              <input
                className={INPUT_CLASS}
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                required
                disabled={busy}
                name="edit_agent_name"
              />
            </div>
            <div>
              <span className={LABEL_CLASS}>Primary color</span>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="color"
                  className="h-10 w-14 cursor-pointer rounded border border-gray-200"
                  value={normalizeHexColor(color)}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={busy}
                />
                <input
                  className={`${INPUT_CLASS} font-mono text-sm`}
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  disabled={busy}
                  name="edit_primary_color"
                />
              </div>
            </div>
            <div>
              <label className={LABEL_CLASS}>Logo URL (optional)</label>
              <input
                type="url"
                className={INPUT_CLASS}
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                disabled={busy}
                name="edit_logo_url"
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Billing model</label>
              <select
                className={INPUT_CLASS}
                value={billing}
                onChange={(e) => setBilling(e.target.value as BillingModelApi)}
                disabled={busy}
                name="edit_billing_model"
              >
                <option value="cash">Cash</option>
                <option value="insurance">Insurance</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button type="submit" className={DS_PRIMARY_BTN} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

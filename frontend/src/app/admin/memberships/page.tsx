"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";
const BRAND = "#1F7A47";
const TREATMENT_TYPE_NAMES: Record<string, string> = {
  "92e261f3-1f97-491c-96e1-8fddce8c4aa6": "Dry Needling",
  "3a1ef48b-966b-4240-881c-b7d2f4de7a7a": "Chiropractic",
  "813074b1-6d97-442e-b506-4b1e4e4739d1": "Physical Therapy",
  "3ed811c3-019b-4f0c-9a1e-e38f705f083b": "Shockwave Therapy",
  "14c4a2de-7fe6-4fc1-8998-7fc77c3b0b11": "Cupping",
};

type TierServiceRow = { treatment_type_id?: string };
type MembershipTier = {
  id: string;
  clinic_id: string;
  name: string;
  description?: string | null;
  price_cents: number;
  billing_cycle: string;
  visits_included: number;
  visits_roll_over: boolean;
  is_active: boolean;
  membership_tier_services?: TierServiceRow[] | TierServiceRow | null;
};

type MembershipTierNested = {
  name?: string;
  price_cents?: number;
  billing_cycle?: string;
  visits_included?: number;
};

type PatientMembership = {
  id: string;
  patient_id: string;
  tier_id: string;
  status: string;
  visits_used: number;
  visits_remaining: number;
  visits_included?: number;
  next_billing_date?: string | null;
  auto_renew: boolean;
  membership_tiers?: MembershipTierNested | MembershipTierNested[] | null;
};

type TreatmentOption = { id: string; name: string };

function tierServiceIds(tier: MembershipTier): string[] {
  const raw = tier.membership_tier_services;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((x) => x.treatment_type_id).filter(Boolean) as string[];
}

function nestedTierName(row: PatientMembership): string {
  const t = row.membership_tiers;
  if (t && !Array.isArray(t)) return (t as MembershipTierNested).name ?? "—";
  if (Array.isArray(t) && t[0]) return t[0].name ?? "—";
  return "—";
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
}

function formatBillingCycle(c: string): string {
  const m: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
  };
  return m[c] ?? c;
}

function treatmentOptionsFromMap(): TreatmentOption[] {
  return Object.entries(TREATMENT_TYPE_NAMES)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function treatmentTypeLabel(id: string): string {
  return TREATMENT_TYPE_NAMES[id] ?? id;
}

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "active") return "bg-emerald-100 text-emerald-800";
  if (s === "paused") return "bg-amber-100 text-amber-900";
  if (s === "cancelled") return "bg-red-100 text-red-800";
  if (s === "expired") return "bg-neutral-200 text-neutral-600";
  return "bg-neutral-100 text-neutral-700";
}

type TabId = "tiers" | "enrollments";

const STATUS_OPTIONS = ["active", "paused", "cancelled", "expired"] as const;

export default function AdminMembershipsPage() {
  const [tab, setTab] = useState<TabId>("tiers");
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [enrollments, setEnrollments] = useState<PatientMembership[]>([]);
  const [treatmentOptions] = useState<TreatmentOption[]>(() =>
    treatmentOptionsFromMap(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTierId, setSavingTierId] = useState<string | null>(null);
  const [savingEnrollmentId, setSavingEnrollmentId] = useState<string | null>(null);

  const [tierModalOpen, setTierModalOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<MembershipTier | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriceDollars, setFormPriceDollars] = useState("");
  const [formBillingCycle, setFormBillingCycle] = useState<
    "monthly" | "quarterly" | "annual"
  >("monthly");
  const [formVisitsIncluded, setFormVisitsIncluded] = useState("0");
  const [formVisitsRollOver, setFormVisitsRollOver] = useState(false);
  const [formTreatmentIds, setFormTreatmentIds] = useState<string[]>([]);
  const [tierSubmitBusy, setTierSubmitBusy] = useState(false);

  const [changeTierModal, setChangeTierModal] = useState<{
    membership: PatientMembership;
    newTierId: string;
  } | null>(null);
  const [changeTierBusy, setChangeTierBusy] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [tiersRes, enrollRes] = await Promise.all([
        fetch(
          `${API_BASE}/membership-tiers?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        ),
        fetch(
          `${API_BASE}/patient-memberships?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        ),
      ]);
      const tiersJson = tiersRes.ok ? await tiersRes.json() : [];
      const enrollJson = enrollRes.ok ? await enrollRes.json() : [];
      setTiers(Array.isArray(tiersJson) ? tiersJson : []);
      setEnrollments(Array.isArray(enrollJson) ? enrollJson : []);
      if (!tiersRes.ok) {
        setError(`Tiers: ${tiersRes.status} ${tiersRes.statusText}`);
      } else if (!enrollRes.ok) {
        setError(`Enrollments: ${enrollRes.status} ${enrollRes.statusText}`);
      } else {
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      setTiers([]);
      setEnrollments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  function openCreateTierModal() {
    setEditingTier(null);
    setFormName("");
    setFormDescription("");
    setFormPriceDollars("");
    setFormBillingCycle("monthly");
    setFormVisitsIncluded("0");
    setFormVisitsRollOver(false);
    setFormTreatmentIds([]);
    setTierModalOpen(true);
  }

  function openEditTierModal(tier: MembershipTier) {
    setEditingTier(tier);
    setFormName(tier.name);
    setFormDescription(tier.description ?? "");
    setFormPriceDollars((Number(tier.price_cents) / 100).toFixed(2));
    setFormBillingCycle(
      tier.billing_cycle === "quarterly" || tier.billing_cycle === "annual"
        ? tier.billing_cycle
        : "monthly",
    );
    setFormVisitsIncluded(String(tier.visits_included));
    setFormVisitsRollOver(!!tier.visits_roll_over);
    setFormTreatmentIds(tierServiceIds(tier));
    setTierModalOpen(true);
  }

  function toggleTreatmentId(id: string) {
    setFormTreatmentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submitTierModal() {
    const dollars = parseFloat(formPriceDollars);
    if (!formName.trim() || Number.isNaN(dollars) || dollars < 0) {
      setError("Enter a valid tier name and price.");
      return;
    }
    const visits = parseInt(formVisitsIncluded, 10);
    if (Number.isNaN(visits) || visits < 0) {
      setError("Visits included must be a non-negative integer.");
      return;
    }
    const price_cents = Math.round(dollars * 100);
    setTierSubmitBusy(true);
    setError(null);
    try {
      if (editingTier) {
        const res = await fetch(
          `${API_BASE}/membership-tiers/${encodeURIComponent(editingTier.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: formName.trim(),
              description: formDescription.trim() || null,
              price_cents,
              billing_cycle: formBillingCycle,
              visits_included: visits,
              visits_roll_over: formVisitsRollOver,
              treatment_type_ids: formTreatmentIds,
            }),
          },
        );
        if (!res.ok) {
          setError(await res.text().catch(() => res.statusText));
          return;
        }
      } else {
        const res = await fetch(`${API_BASE}/membership-tiers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: CLINIC_ID,
            name: formName.trim(),
            description: formDescription.trim() || null,
            price_cents,
            billing_cycle: formBillingCycle,
            visits_included: visits,
            visits_roll_over: formVisitsRollOver,
            is_active: true,
            treatment_type_ids: formTreatmentIds,
          }),
        });
        if (!res.ok) {
          setError(await res.text().catch(() => res.statusText));
          return;
        }
      }
      setTierModalOpen(false);
      await loadData();
    } finally {
      setTierSubmitBusy(false);
    }
  }

  async function toggleTierActive(tier: MembershipTier) {
    setSavingTierId(tier.id);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/membership-tiers/${encodeURIComponent(tier.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !tier.is_active }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      await loadData();
    } finally {
      setSavingTierId(null);
    }
  }

  async function patchEnrollmentStatus(membershipId: string, status: string) {
    setSavingEnrollmentId(membershipId);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/patient-memberships/${encodeURIComponent(membershipId)}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      await loadData();
    } finally {
      setSavingEnrollmentId(null);
    }
  }

  async function submitChangeTier() {
    if (!changeTierModal) return;
    const { membership, newTierId } = changeTierModal;
    if (!newTierId || newTierId === membership.tier_id) {
      setChangeTierModal(null);
      return;
    }
    setChangeTierBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/patient-memberships/${encodeURIComponent(membership.id)}/tier`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_tier_id: newTierId }),
        },
      );
      if (!res.ok) {
        const t = await res.text().catch(() => res.statusText);
        setError(t || `${res.status}`);
        return;
      }
      setChangeTierModal(null);
      await loadData();
    } finally {
      setChangeTierBusy(false);
    }
  }

  const tierOptionsForChange = useMemo(() => {
    if (!changeTierModal) return [];
    return tiers.filter((t) => t.id !== changeTierModal.membership.tier_id);
  }, [changeTierModal, tiers]);

  const pill =
    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors border";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-neutral-900">Memberships</h1>
        <span
          className="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium"
          style={{
            borderColor: `${BRAND}4d`,
            backgroundColor: `${BRAND}1a`,
            color: BRAND,
          }}
        >
          {loading
            ? "…"
            : `${tiers.length} tier${tiers.length === 1 ? "" : "s"} · ${enrollments.length} enrollment${enrollments.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {error ? (
        <div
          className="mb-4 rounded-md border px-3 py-2 text-sm text-red-800"
          style={{ borderColor: "#fecaca", backgroundColor: "#fef2f2" }}
        >
          {error}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          className={[
            pill,
            tab === "tiers"
              ? "border-transparent text-white"
              : "border-neutral-200 bg-white text-neutral-700 hover:border-[#1F7A47]/40",
          ].join(" ")}
          style={tab === "tiers" ? { backgroundColor: BRAND } : undefined}
          onClick={() => setTab("tiers")}
        >
          Tiers
        </button>
        <button
          type="button"
          className={[
            pill,
            tab === "enrollments"
              ? "border-transparent text-white"
              : "border-neutral-200 bg-white text-neutral-700 hover:border-[#1F7A47]/40",
          ].join(" ")}
          style={tab === "enrollments" ? { backgroundColor: BRAND } : undefined}
          onClick={() => setTab("enrollments")}
        >
          Enrollments
        </button>
      </div>

      {tab === "tiers" ? (
        <section>
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => openCreateTierModal()}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: BRAND }}
            >
              New tier
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-neutral-600">Loading tiers…</p>
          ) : tiers.length === 0 ? (
            <p className="text-sm text-neutral-600">No membership tiers yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tiers.map((tier) => {
                const ids = tierServiceIds(tier);
                const busy = savingTierId === tier.id;
                return (
                  <div
                    key={tier.id}
                    className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-lg font-semibold text-neutral-900">
                        {tier.name}
                      </h2>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          tier.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-neutral-200 text-neutral-600"
                        }`}
                      >
                        {tier.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">
                      {formatPrice(tier.price_cents)}
                    </p>
                    <p className="mt-1 text-sm text-neutral-600">
                      {formatBillingCycle(tier.billing_cycle)} ·{" "}
                      {tier.visits_included} visit
                      {tier.visits_included === 1 ? "" : "s"} included
                    </p>
                    <p className="mt-1 text-sm text-neutral-600">
                      Roll over:{" "}
                      <span className="font-medium text-neutral-800">
                        {tier.visits_roll_over ? "Yes" : "No"}
                      </span>
                    </p>
                    <div className="mt-3 border-t border-neutral-100 pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                        Treatment types
                      </p>
                      {ids.length === 0 ? (
                        <p className="mt-1 text-xs text-neutral-500">None</p>
                      ) : (
                        <ul className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                          {ids.map((id) => (
                            <li
                              key={id}
                              className="inline-flex rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700"
                              title={id}
                            >
                              {treatmentTypeLabel(id)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEditTierModal(tier)}
                        className="rounded-md border px-3 py-1.5 text-xs font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 disabled:opacity-50"
                        style={{ borderColor: `${BRAND}66` }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleTierActive(tier)}
                        className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
                      >
                        {tier.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section>
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Patient ID
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Tier
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Status
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700 text-right">
                      Visits used
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700 text-right">
                      Visits remaining
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Next billing
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Auto renew
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-neutral-500"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : enrollments.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-neutral-500"
                      >
                        No enrollments for this clinic.
                      </td>
                    </tr>
                  ) : (
                    enrollments.map((row, idx) => {
                      const busy = savingEnrollmentId === row.id;
                      const nb = row.next_billing_date
                        ? new Date(
                            row.next_billing_date + "T12:00:00",
                          ).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—";
                      return (
                        <tr
                          key={row.id}
                          className={[
                            "border-b border-neutral-100 transition-colors hover:bg-neutral-50/80",
                            idx % 2 === 1 ? "bg-neutral-50/80" : "bg-white",
                          ].join(" ")}
                        >
                          <td className="max-w-[200px] px-4 py-3 font-mono text-xs text-neutral-800 break-all">
                            {row.patient_id}
                          </td>
                          <td className="px-4 py-3 font-medium text-neutral-900">
                            {nestedTierName(row)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(row.status)}`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-neutral-800">
                            {row.visits_used}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-neutral-800">
                            {row.visits_remaining}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                            {nb}
                          </td>
                          <td className="px-4 py-3 text-neutral-700">
                            {row.auto_renew ? "Yes" : "No"}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <select
                                className="min-w-[8rem] rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs outline-none disabled:opacity-50"
                                style={{ boxShadow: `0 0 0 1px transparent` }}
                                onFocus={(e) => {
                                  e.target.style.boxShadow = `0 0 0 2px ${BRAND}40`;
                                }}
                                onBlur={(e) => {
                                  e.target.style.boxShadow = "none";
                                }}
                                value={row.status}
                                disabled={busy}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  void patchEnrollmentStatus(row.id, v);
                                }}
                                aria-label="Change membership status"
                              >
                                {STATUS_OPTIONS.map((s) => (
                                  <option key={s} value={s}>
                                    {s}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={busy || tiers.length < 2}
                                onClick={() =>
                                  setChangeTierModal({
                                    membership: row,
                                    newTierId:
                                      tiers.find((t) => t.id !== row.tier_id)
                                        ?.id ?? "",
                                  })
                                }
                                className="whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                style={{ backgroundColor: BRAND }}
                              >
                                Change tier
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {tierModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-200 bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal
            aria-labelledby="tier-modal-title"
          >
            <h2
              id="tier-modal-title"
              className="text-lg font-semibold text-neutral-900"
            >
              {editingTier ? "Edit tier" : "Create tier"}
            </h2>
            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-neutral-700">
                Name
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none"
                  style={{ boxShadow: "none" }}
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Description
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Price (USD)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={formPriceDollars}
                  onChange={(e) => setFormPriceDollars(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Billing cycle
                <select
                  value={formBillingCycle}
                  onChange={(e) =>
                    setFormBillingCycle(
                      e.target.value as "monthly" | "quarterly" | "annual",
                    )
                  }
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-neutral-700">
                Visits included
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={formVisitsIncluded}
                  onChange={(e) => setFormVisitsIncluded(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-700">
                <input
                  type="checkbox"
                  checked={formVisitsRollOver}
                  onChange={(e) => setFormVisitsRollOver(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                  style={{ accentColor: BRAND }}
                />
                Visits roll over
              </label>
              <fieldset>
                <legend className="text-sm font-medium text-neutral-700">
                  Treatment types (from clinic appointments)
                </legend>
                {treatmentOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-500">
                    No treatment types found in recent appointments. You can still
                    save the tier and add services later via Edit.
                  </p>
                ) : (
                  <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-md border border-neutral-200 p-2">
                    {treatmentOptions.map((opt) => (
                      <li key={opt.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={formTreatmentIds.includes(opt.id)}
                            onChange={() => toggleTreatmentId(opt.id)}
                            className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                            style={{ accentColor: BRAND }}
                          />
                          <span>
                            <span className="font-medium text-neutral-900">
                              {treatmentTypeLabel(opt.id)}
                            </span>
                            <span className="mt-0.5 block font-mono text-xs text-neutral-500">
                              {opt.id}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTierModalOpen(false)}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={tierSubmitBusy}
                onClick={() => void submitTierModal()}
                className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: BRAND }}
              >
                {tierSubmitBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {changeTierModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-neutral-900">Change tier</h2>
            <p className="mt-2 text-sm text-neutral-600">
              Patient membership:{" "}
              <span className="font-mono text-xs">{changeTierModal.membership.id}</span>
            </p>
            {tierOptionsForChange.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-600">
                No other tiers available. Create another tier first.
              </p>
            ) : (
              <label className="mt-4 block text-sm font-medium text-neutral-700">
                New tier
                <select
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                  value={changeTierModal.newTierId}
                  onChange={(e) =>
                    setChangeTierModal((m) =>
                      m ? { ...m, newTierId: e.target.value } : m,
                    )
                  }
                >
                  <option value="">Select tier…</option>
                  {tierOptionsForChange.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {formatPrice(t.price_cents)} /{" "}
                      {formatBillingCycle(t.billing_cycle)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setChangeTierModal(null)}
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  changeTierBusy ||
                  !changeTierModal.newTierId ||
                  tierOptionsForChange.length === 0
                }
                onClick={() => void submitChangeTier()}
                className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: BRAND }}
              >
                {changeTierBusy ? "Saving…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

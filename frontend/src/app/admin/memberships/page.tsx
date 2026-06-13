"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  activeInactiveBadgeClass,
  DS_CARD,
  DS_FILTER_BAR,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
  membershipStatusBadgeClass,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

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

type MembershipStats = {
  active_members: number;
  monthly_revenue_cents: number;
  renewal_rate: number;
  visits_remaining: number;
  mrr_annualized_cents: number;
};
type RevenuePoint = { month: string; revenue_cents: number };
type UtilizationData = {
  avg_utilization: number;
  total: number;
  buckets: { label: string; count: number; color: string }[];
};
type TierStat = {
  tier_id: string;
  name: string;
  members: number;
  revenue_mtd_cents: number;
  utilization: number;
};
type RecentEnrollment = {
  initials: string;
  name: string;
  tier: string;
  enrolled_at: string;
  amount_cents: number;
};
type ActivityEvent = { event: string; timestamp: string; icon: string };
type VisitOverview = { name: string; used: number; included: number; color: string };

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

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

const STATUS_OPTIONS = ["active", "paused", "cancelled", "expired"] as const;
type TabId = "tiers" | "enrollments";

function StatCard({
  icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  trend?: string;
}) {
  const trendUp = trend?.startsWith("+");
  return (
    <div className={`${DS_CARD} flex items-start gap-4 min-w-0`}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-50 text-xl">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold tabular-nums text-gray-900 leading-tight">
          {value}
        </p>
        <p className="mt-0.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}
        </p>
        {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
        {trend && (
          <p
            className={`mt-1 text-xs font-semibold ${trendUp ? "text-green-600" : "text-red-500"}`}
          >
            {trend}
          </p>
        )}
      </div>
    </div>
  );
}

export default function AdminMembershipsPage() {
  const { clinicId } = useClinic();
  const [tab, setTab] = useState<TabId>("tiers");

  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [enrollments, setEnrollments] = useState<PatientMembership[]>([]);
  const [treatmentOptions] = useState<TreatmentOption[]>(() =>
    treatmentOptionsFromMap(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTierId, setSavingTierId] = useState<string | null>(null);
  const [savingEnrollmentId, setSavingEnrollmentId] = useState<string | null>(
    null,
  );
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

  const [stats, setStats] = useState<MembershipStats>({
    active_members: 0,
    monthly_revenue_cents: 0,
    renewal_rate: 0,
    visits_remaining: 0,
    mrr_annualized_cents: 0,
  });
  const [revenueChart, setRevenueChart] = useState<RevenuePoint[]>([]);
  const [utilization, setUtilization] = useState<UtilizationData>({
    avg_utilization: 0,
    total: 0,
    buckets: [],
  });
  const [tierStats, setTierStats] = useState<TierStat[]>([]);
  const [recentEnrollments, setRecentEnrollments] = useState<RecentEnrollment[]>(
    [],
  );
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  const [visitsOverview, setVisitsOverview] = useState<VisitOverview[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [
        tiersRes,
        enrollRes,
        statsRes,
        revenueRes,
        utilRes,
        tierStatsRes,
        recentRes,
        activityRes,
        visitsRes,
      ] = await Promise.all([
        fetch(
          `${API_BASE}/membership-tiers?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/patient-memberships?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/api/memberships/stats?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/api/memberships/revenue-chart?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/api/memberships/utilization?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/api/memberships/tier-stats?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/api/memberships/recent-enrollments?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/api/memberships/activity-feed?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
        fetch(
          `${API_BASE}/api/memberships/visits-overview?clinic_id=${encodeURIComponent(clinicId)}`,
        ),
      ]);

      const tiersJson = tiersRes.ok ? await tiersRes.json() : [];
      const enrollJson = enrollRes.ok ? await enrollRes.json() : [];
      setTiers(Array.isArray(tiersJson) ? tiersJson : []);
      setEnrollments(Array.isArray(enrollJson) ? enrollJson : []);

      if (statsRes.ok) setStats(await statsRes.json());
      if (revenueRes.ok) setRevenueChart(await revenueRes.json());
      if (utilRes.ok) setUtilization(await utilRes.json());
      if (tierStatsRes.ok) setTierStats(await tierStatsRes.json());
      if (recentRes.ok) setRecentEnrollments(await recentRes.json());
      if (activityRes.ok) setActivityFeed(await activityRes.json());
      if (visitsRes.ok) setVisitsOverview(await visitsRes.json());

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
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
            clinic_id: clinicId,
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
        setError(await res.text().catch(() => res.statusText));
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

  function activityIcon(icon: string) {
    const base =
      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm";
    if (icon === "enroll")
      return (
        <span className={`${base} bg-green-50 text-green-600`}>＋</span>
      );
    if (icon === "cancel")
      return <span className={`${base} bg-red-50 text-red-500`}>✕</span>;
    if (icon === "pause")
      return <span className={`${base} bg-amber-50 text-amber-500`}>⏸</span>;
    return <span className={`${base} bg-gray-100 text-gray-500`}>↻</span>;
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className={DS_PAGE_TITLE}>Memberships</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Tiers, member enrollments and revenue performance.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" className={DS_SECONDARY_BTN}>
            <span className="mr-1.5">📊</span> Reports
          </button>
          <button
            type="button"
            onClick={openCreateTierModal}
            className={DS_PRIMARY_BTN}
          >
            + New Tier
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          icon="👥"
          label="Active Members"
          value={loading ? "—" : String(stats.active_members)}
          sub="This month"
        />
        <StatCard
          icon="💵"
          label="Monthly Revenue"
          value={loading ? "—" : formatPrice(stats.monthly_revenue_cents)}
        />
        <StatCard
          icon="🔄"
          label="Renewal Rate"
          value={loading ? "—" : `${stats.renewal_rate}%`}
        />
        <StatCard
          icon="📅"
          label="Visits Remaining"
          value={loading ? "—" : stats.visits_remaining.toLocaleString()}
          sub="This month"
        />
        <StatCard
          icon="📈"
          label="MRR (Annualized)"
          value={loading ? "—" : formatPrice(stats.mrr_annualized_cents)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className={`${DS_CARD} lg:col-span-3`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Membership Revenue
              </p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {formatPrice(stats.monthly_revenue_cents)}{" "}
                <span className="text-sm font-normal text-gray-400">
                  this month
                </span>
              </p>
            </div>
            <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
              Last 6 Months
            </span>
          </div>
          {revenueChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart
                data={revenueChart}
                margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 100).toLocaleString()}`}
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={(v: unknown) => [
                    formatPrice(Number(v)),
                    "Revenue",
                  ]}
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid #F3F4F6",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue_cents"
                  stroke="#16A34A"
                  strokeWidth={2}
                  fill="url(#revenueGrad)"
                  dot={{ fill: "#16A34A", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[180px] items-center justify-center text-sm text-gray-400">
              No revenue data yet
            </div>
          )}
        </div>

        <div className={`${DS_CARD} lg:col-span-2`}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-4">
            Membership Utilization
          </p>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <PieChart width={120} height={120}>
                <Pie
                  data={
                    utilization.buckets.length > 0
                      ? utilization.buckets
                      : [{ label: "No data", count: 1, color: "#E5E7EB" }]
                  }
                  cx={55}
                  cy={55}
                  innerRadius={38}
                  outerRadius={55}
                  dataKey="count"
                  startAngle={90}
                  endAngle={-270}
                  strokeWidth={0}
                >
                  {(utilization.buckets.length > 0
                    ? utilization.buckets
                    : [{ color: "#E5E7EB" }]
                  ).map((b, i) => (
                    <Cell key={i} fill={b.color} />
                  ))}
                </Pie>
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xl font-bold text-gray-900">
                  {utilization.avg_utilization}%
                </span>
                <span className="text-[10px] text-gray-400">Avg. Util.</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {utilization.buckets.map((b) => (
                <div
                  key={b.label}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: b.color }}
                    />
                    <span className="text-xs text-gray-600">{b.label}</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-800 tabular-nums">
                    {b.count}{" "}
                    <span className="font-normal text-gray-400">
                      (
                      {utilization.total > 0
                        ? Math.round((b.count / utilization.total) * 100)
                        : 0}
                      %)
                    </span>
                  </span>
                </div>
              ))}
              {utilization.buckets.length === 0 && (
                <p className="text-xs text-gray-400">No utilization data yet</p>
              )}
            </div>
          </div>
          {utilization.total > 0 && (
            <button
              type="button"
              className="mt-4 text-xs font-medium text-green-600 hover:text-green-700"
            >
              View Utilization Report →
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-gray-900">
          Membership Tiers
        </h2>
        <div className="flex items-center gap-3">
          <div className={`${DS_FILTER_BAR} flex gap-2`}>
            <button
              type="button"
              className={[
                pill,
                tab === "tiers"
                  ? "border-transparent bg-[#16A34A] text-white hover:bg-[#15803D]"
                  : "border-gray-200 bg-white text-gray-700 hover:border-green-500/40",
              ].join(" ")}
              onClick={() => setTab("tiers")}
            >
              Tiers
            </button>
            <button
              type="button"
              className={[
                pill,
                tab === "enrollments"
                  ? "border-transparent bg-[#16A34A] text-white hover:bg-[#15803D]"
                  : "border-gray-200 bg-white text-gray-700 hover:border-green-500/40",
              ].join(" ")}
              onClick={() => setTab("enrollments")}
            >
              Enrollments
            </button>
          </div>
        </div>
      </div>

      {tab === "tiers" ? (
        <section className="mt-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading tiers…</p>
          ) : tiers.length === 0 ? (
            <p className="text-sm text-gray-500">No membership tiers yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {tiers.map((tier) => {
                const ids = tierServiceIds(tier);
                const busy = savingTierId === tier.id;
                const ts = tierStats.find((s) => s.tier_id === tier.id);
                return (
                  <div key={tier.id} className={DS_CARD}>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold text-gray-900">
                        {tier.name}
                      </h3>
                      <span
                        className={`shrink-0 ${activeInactiveBadgeClass(tier.is_active)}`}
                      >
                        {tier.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">
                      {formatPrice(tier.price_cents)}
                      <span className="text-sm font-normal text-gray-400">
                        {" "}
                        /mo
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {tier.visits_included} visits included · Roll over:{" "}
                      {tier.visits_roll_over ? "Yes" : "No"}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3">
                      <div>
                        <p className="text-xs text-gray-400 uppercase tracking-wide">
                          Members
                        </p>
                        <p className="text-sm font-bold text-gray-900 mt-0.5">
                          {ts ? ts.members : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 uppercase tracking-wide">
                          Revenue MTD
                        </p>
                        <p className="text-sm font-bold text-gray-900 mt-0.5">
                          {ts ? formatPrice(ts.revenue_mtd_cents) : "—"}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-gray-400 uppercase tracking-wide">
                            Utilization
                          </p>
                          <p className="text-xs font-semibold text-gray-700">
                            {ts ? `${ts.utilization}%` : "—"}
                          </p>
                        </div>
                        {ts && (
                          <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-green-500 transition-all"
                              style={{ width: `${ts.utilization}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                        Treatment Types
                      </p>
                      {ids.length === 0 ? (
                        <p className="mt-1 text-xs text-gray-400">None</p>
                      ) : (
                        <ul className="mt-2 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                          {ids.map((id) => (
                            <li
                              key={id}
                              className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                            >
                              {treatmentTypeLabel(id)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openEditTierModal(tier)}
                        className={`${DS_SECONDARY_BTN} flex-1 disabled:opacity-50`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleTierActive(tier)}
                        className={`${DS_SECONDARY_BTN} flex-1 disabled:opacity-50`}
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
        <section className="mt-4">
          <div className={DS_TABLE_WRAP}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className={DS_TABLE_HEAD}>
                  <tr>
                    <th className={DS_TH}>Patient ID</th>
                    <th className={DS_TH}>Tier</th>
                    <th className={DS_TH}>Status</th>
                    <th className={`${DS_TH} text-right`}>Visits used</th>
                    <th className={`${DS_TH} text-right`}>Visits remaining</th>
                    <th className={DS_TH}>Next billing</th>
                    <th className={DS_TH}>Auto renew</th>
                    <th className={DS_TH}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-10 text-center text-gray-500"
                      >
                        Loading…
                      </td>
                    </tr>
                  ) : enrollments.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-6 py-10 text-center text-gray-500"
                      >
                        No enrollments for this clinic.
                      </td>
                    </tr>
                  ) : (
                    enrollments.map((row) => {
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
                        <tr key={row.id} className={DS_TR}>
                          <td
                            className={`max-w-[200px] break-all ${DS_TD_PRIMARY} font-mono text-xs`}
                          >
                            {row.patient_id}
                          </td>
                          <td className={`${DS_TD_PRIMARY} font-medium`}>
                            {nestedTierName(row)}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <span
                              className={`capitalize ${membershipStatusBadgeClass(row.status)}`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td
                            className={`${DS_TD_PRIMARY} text-right tabular-nums`}
                          >
                            {row.visits_used}
                          </td>
                          <td
                            className={`${DS_TD_PRIMARY} text-right tabular-nums`}
                          >
                            {row.visits_remaining}
                          </td>
                          <td className={`whitespace-nowrap ${DS_TD_PRIMARY}`}>
                            {nb}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {row.auto_renew ? "Yes" : "No"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <select
                                className={`h-9 min-w-[8rem] ${DS_INPUT} px-2 disabled:opacity-50`}
                                value={row.status}
                                disabled={busy}
                                onChange={(e) => {
                                  void patchEnrollmentStatus(
                                    row.id,
                                    e.target.value,
                                  );
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
                                className={`${DS_PRIMARY_BTN} whitespace-nowrap disabled:opacity-50`}
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

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className={`${DS_CARD} lg:col-span-3`}>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-4">
            Membership Activity Feed
          </p>
          {activityFeed.length === 0 ? (
            <p className="text-sm text-gray-400">No recent activity.</p>
          ) : (
            <ul className="space-y-3">
              {activityFeed.map((ev, i) => (
                <li key={i} className="flex items-start gap-3">
                  {activityIcon(ev.icon)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 leading-snug">
                      {ev.event}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatTimestamp(ev.timestamp)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className={DS_CARD}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Recent Enrollments
              </p>
              <button
                type="button"
                className="text-xs text-green-600 hover:text-green-700 font-medium"
              >
                View All →
              </button>
            </div>
            {recentEnrollments.length === 0 ? (
              <p className="text-sm text-gray-400">No enrollments yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                <div className="grid grid-cols-4 gap-2 pb-2">
                  <span className="col-span-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Member
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Tier
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 text-right">
                    Amount
                  </span>
                </div>
                {recentEnrollments.map((e, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-4 gap-2 items-center py-2"
                  >
                    <div className="col-span-2 flex items-center gap-2 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
                        {e.initials}
                      </span>
                      <span className="text-xs font-medium text-gray-800 truncate">
                        {e.name}
                      </span>
                    </div>
                    <span className="text-xs text-gray-600 truncate">
                      {e.tier}
                    </span>
                    <span className="text-xs font-semibold text-gray-800 text-right tabular-nums">
                      {formatPrice(e.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={DS_CARD}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Visits Remaining Overview
              </p>
              <span className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1">
                This month
              </span>
            </div>
            {visitsOverview.length === 0 ? (
              <p className="text-sm text-gray-400">No visit data yet.</p>
            ) : (
              <div className="space-y-3">
                {visitsOverview.map((v) => {
                  const pct =
                    v.included > 0
                      ? Math.round((v.used / v.included) * 100)
                      : 0;
                  const remaining =
                    v.included === 0 ? "∞" : String(v.included - v.used);
                  return (
                    <div key={v.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-700">
                          {v.name}
                        </span>
                        <span className="text-xs font-semibold text-gray-800 tabular-nums">
                          {remaining} / {v.included === 0 ? "∞" : v.included}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: v.color }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className="mt-4 text-xs font-medium text-green-600 hover:text-green-700"
            >
              View Full Report →
            </button>
          </div>
        </div>
      </div>

      {tierModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            role="dialog"
            aria-modal
            aria-labelledby="tier-modal-title"
          >
            <h2
              id="tier-modal-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              {editingTier ? "Edit tier" : "Create tier"}
            </h2>
            <div className="space-y-4 pt-5">
              <label className="block text-sm font-medium text-gray-700">
                Name
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Description
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Price (USD)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={formPriceDollars}
                  onChange={(e) => setFormPriceDollars(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Billing cycle
                <select
                  value={formBillingCycle}
                  onChange={(e) =>
                    setFormBillingCycle(
                      e.target.value as "monthly" | "quarterly" | "annual",
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Visits included
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={formVisitsIncluded}
                  onChange={(e) => setFormVisitsIncluded(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={formVisitsRollOver}
                  onChange={(e) => setFormVisitsRollOver(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                  style={{ accentColor: "#16A34A" }}
                />
                Visits roll over
              </label>
              <fieldset>
                <legend className="text-sm font-medium text-gray-700">
                  Treatment types
                </legend>
                {treatmentOptions.length === 0 ? (
                  <p className="mt-2 text-xs text-gray-500">
                    No treatment types found. You can still save and add
                    services later via Edit.
                  </p>
                ) : (
                  <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-lg border border-gray-100 p-2">
                    {treatmentOptions.map((opt) => (
                      <li key={opt.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={formTreatmentIds.includes(opt.id)}
                            onChange={() => toggleTreatmentId(opt.id)}
                            className="mt-0.5 h-4 w-4 rounded border-gray-300"
                            style={{ accentColor: "#16A34A" }}
                          />
                          <span>
                            <span className="font-medium text-gray-900">
                              {treatmentTypeLabel(opt.id)}
                            </span>
                            <span className="mt-0.5 block font-mono text-xs text-gray-500">
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
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => setTierModalOpen(false)}
                className="rounded-xl border border-gray-100 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={tierSubmitBusy}
                onClick={() => void submitTierModal()}
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
              >
                {tierSubmitBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {changeTierModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={`w-full max-w-md ${DS_CARD}`}>
            <h2 className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900">
              Change tier
            </h2>
            <div className="pt-5">
              <p className="text-sm text-gray-600">
                Patient membership:{" "}
                <span className="font-mono text-xs">
                  {changeTierModal.membership.id}
                </span>
              </p>
              {tierOptionsForChange.length === 0 ? (
                <p className="mt-4 text-sm text-gray-600">
                  No other tiers available. Create another tier first.
                </p>
              ) : (
                <label className="mt-4 block text-sm font-medium text-gray-700">
                  New tier
                  <select
                    className={`mt-1 h-9 w-full ${DS_INPUT}`}
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
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => setChangeTierModal(null)}
                className="rounded-xl border border-gray-100 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
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
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
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

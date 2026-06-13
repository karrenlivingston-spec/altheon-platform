"use client";

import { useCallback, useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  activeInactiveBadgeClass,
  DS_CARD,
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
} from "@/app/admin/designSystem";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const COLOR_OPTIONS = ["gray", "green", "blue", "purple", "amber", "red"] as const;
type GroupColor = (typeof COLOR_OPTIONS)[number];

type PatientGroup = {
  id: string;
  clinic_id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  priority_flag?: boolean | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

type GroupStats = {
  total_patients: number;
  active_groups: number;
  total_groups: number;
  appointments_mtd: number;
  revenue_mtd_cents: number;
};
type GroupCard = {
  id: string;
  name: string;
  description: string;
  color: string;
  priority_flag: boolean;
  is_active: boolean;
  patient_count: number;
  revenue_mtd_cents: number;
  appointments_mtd: number;
};
type InsightItem = { name: string; value: GroupCard } | null;
type GroupInsights = {
  top_patients: InsightItem;
  top_appointments: InsightItem;
  top_revenue: InsightItem;
};
type DistributionSegment = {
  name: string;
  count: number;
  pct: number;
  color: string;
};
type GroupDistribution = { total: number; segments: DistributionSegment[] };
type ActivityRow = {
  group_name: string;
  group_color: string;
  activity: string;
  patients_affected: number;
  timestamp: string;
  performed_by: string;
};

const PRIORITY_BADGE =
  "inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700";

function colorDotClass(color: string | null | undefined): string {
  const c = (color ?? "gray").trim().toLowerCase();
  const map: Record<string, string> = {
    gray: "bg-gray-400",
    green: "bg-green-500",
    blue: "bg-blue-500",
    purple: "bg-purple-500",
    amber: "bg-amber-400",
    red: "bg-red-500",
  };
  return `h-2.5 w-2.5 shrink-0 rounded-full ${map[c] ?? map.gray}`;
}

function colorBgClass(color: string | null | undefined): string {
  const c = (color ?? "gray").trim().toLowerCase();
  const map: Record<string, string> = {
    gray: "bg-gray-100",
    green: "bg-green-50",
    blue: "bg-blue-50",
    purple: "bg-purple-50",
    amber: "bg-amber-50",
    red: "bg-red-50",
  };
  return map[c] ?? map.gray;
}

function normalizeColor(value: string): GroupColor {
  const c = value.trim().toLowerCase();
  return (COLOR_OPTIONS as readonly string[]).includes(c)
    ? (c as GroupColor)
    : "gray";
}

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number(cents) || 0) / 100);
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

function groupIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("vip")) return "👑";
  if (n.includes("pi") || n.includes("personal injury")) return "⚖️";
  if (n.includes("workers") || n.includes("comp")) return "📋";
  if (n.includes("dry needl") || n.includes("needling")) return "🪡";
  if (n.includes("high risk") || n.includes("risk")) return "❤️";
  if (n.includes("new patient")) return "🏃";
  return "📁";
}

function StatCard({
  icon,
  value,
  label,
  sub,
  trend,
}: {
  icon: string;
  value: string;
  label: string;
  sub?: string;
  trend?: string;
}) {
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
          <p className="mt-1 text-xs font-semibold text-green-600">{trend}</p>
        )}
      </div>
    </div>
  );
}

export default function AdminGroupsPage() {
  const { clinicId } = useClinic();

  const [groups, setGroups] = useState<PatientGroup[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PatientGroup | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formColor, setFormColor] = useState<GroupColor>("gray");
  const [formPriority, setFormPriority] = useState(false);
  const [formIsActive, setFormIsActive] = useState(true);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [stats, setStats] = useState<GroupStats>({
    total_patients: 0,
    active_groups: 0,
    total_groups: 0,
    appointments_mtd: 0,
    revenue_mtd_cents: 0,
  });
  const [cards, setCards] = useState<GroupCard[]>([]);
  const [insights, setInsights] = useState<GroupInsights>({
    top_patients: null,
    top_appointments: null,
    top_revenue: null,
  });
  const [distribution, setDistribution] = useState<GroupDistribution>({
    total: 0,
    segments: [],
  });
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/groups?clinic_id=${encodeURIComponent(clinicId)}`,
      );
      if (!res.ok) {
        setError(`Groups: HTTP ${res.status}`);
        setGroups([]);
        setMemberCounts({});
        return;
      }
      const data: unknown = await res.json();
      const rows = Array.isArray(data) ? (data as PatientGroup[]) : [];
      setGroups(rows);

      const countEntries = await Promise.all(
        rows.map(async (g) => {
          try {
            const mRes = await fetch(
              `${API_BASE}/groups/${encodeURIComponent(g.id)}/members`,
            );
            if (!mRes.ok) return [g.id, 0] as const;
            const members: unknown = await mRes.json();
            const n = Array.isArray(members) ? members.length : 0;
            return [g.id, n] as const;
          } catch {
            return [g.id, 0] as const;
          }
        }),
      );
      setMemberCounts(Object.fromEntries(countEntries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
      setGroups([]);
      setMemberCounts({});
    }
  }, [clinicId]);

  const loadDashboard = useCallback(async () => {
    try {
      const [statsRes, cardsRes, insightsRes, distRes, activityRes] =
        await Promise.all([
          fetch(
            `${API_BASE}/api/groups/stats?clinic_id=${encodeURIComponent(clinicId)}`,
          ),
          fetch(
            `${API_BASE}/api/groups/cards?clinic_id=${encodeURIComponent(clinicId)}`,
          ),
          fetch(
            `${API_BASE}/api/groups/insights?clinic_id=${encodeURIComponent(clinicId)}`,
          ),
          fetch(
            `${API_BASE}/api/groups/distribution?clinic_id=${encodeURIComponent(clinicId)}`,
          ),
          fetch(
            `${API_BASE}/api/groups/activity?clinic_id=${encodeURIComponent(clinicId)}`,
          ),
        ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (cardsRes.ok) setCards(await cardsRes.json());
      if (insightsRes.ok) setInsights(await insightsRes.json());
      if (distRes.ok) setDistribution(await distRes.json());
      if (activityRes.ok) setActivity(await activityRes.json());
    } catch {
      // dashboard errors are non-blocking
    }
  }, [clinicId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([loadGroups(), loadDashboard()]);
    setLoading(false);
  }, [loadGroups, loadDashboard]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function openCreateModal() {
    setEditingGroup(null);
    setFormName("");
    setFormDescription("");
    setFormColor("gray");
    setFormPriority(false);
    setFormIsActive(true);
    setModalOpen(true);
  }

  function openEditModal(group: PatientGroup) {
    setEditingGroup(group);
    setFormName(group.name);
    setFormDescription(group.description ?? "");
    setFormColor(normalizeColor(group.color ?? "gray"));
    setFormPriority(!!group.priority_flag);
    setFormIsActive(group.is_active !== false);
    setModalOpen(true);
  }

  async function submitModal() {
    if (!formName.trim()) {
      setError("Group name is required.");
      return;
    }
    setSubmitBusy(true);
    setError(null);
    try {
      if (editingGroup) {
        const res = await fetch(
          `${API_BASE}/groups/${encodeURIComponent(editingGroup.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: formName.trim(),
              description: formDescription.trim() || null,
              color: formColor,
              priority_flag: formPriority,
              is_active: formIsActive,
            }),
          },
        );
        if (!res.ok) {
          setError(await res.text().catch(() => res.statusText));
          return;
        }
      } else {
        const res = await fetch(`${API_BASE}/groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clinic_id: clinicId,
            name: formName.trim(),
            description: formDescription.trim() || null,
            color: formColor,
            priority_flag: formPriority,
          }),
        });
        if (!res.ok) {
          setError(await res.text().catch(() => res.statusText));
          return;
        }
      }
      setModalOpen(false);
      await loadAll();
    } finally {
      setSubmitBusy(false);
    }
  }

  async function deleteGroup(group: PatientGroup) {
    const ok = window.confirm(
      `Delete "${group.name}"? All patient memberships in this group will be removed. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(group.id);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/groups/${encodeURIComponent(group.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) {
        setError(await res.text().catch(() => res.statusText));
        return;
      }
      await loadAll();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={DS_PAGE_TITLE}>Patient Groups</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Organize patients into groups for priority routing and reporting.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className={`${DS_PRIMARY_BTN} shrink-0`}
        >
          + New Group
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon="👥"
          value={loading ? "—" : String(stats.total_patients)}
          label="Total Patients in Groups"
        />
        <StatCard
          icon="⭐"
          value={loading ? "—" : String(stats.active_groups)}
          label="Active Groups"
          sub={
            stats.total_groups > stats.active_groups
              ? `${stats.total_groups - stats.active_groups} archived`
              : undefined
          }
        />
        <StatCard
          icon="📅"
          value={loading ? "—" : String(stats.appointments_mtd)}
          label="Appointments (MTD)"
        />
        <StatCard
          icon="💵"
          value={loading ? "—" : formatPrice(stats.revenue_mtd_cents)}
          label="Revenue (MTD)"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              Patient Groups
            </h2>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading groups…</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-gray-500">
              No groups yet. Create one to get started.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {cards.map((g) => {
                const busy = deletingId === g.id;
                const fullGroup = groups.find((gr) => gr.id === g.id);
                return (
                  <div key={g.id} className={DS_CARD}>
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${colorBgClass(g.color)}`}
                      >
                        {groupIcon(g.name)}
                      </div>
                      {g.priority_flag && (
                        <span className={PRIORITY_BADGE}>Priority</span>
                      )}
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-gray-900">
                      {g.name}
                    </h3>
                    {g.description && (
                      <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">
                        {g.description}
                      </p>
                    )}

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-2xl font-bold tabular-nums text-gray-900">
                          {g.patient_count}
                        </p>
                        <p className="text-xs text-gray-400">Patients</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold tabular-nums text-gray-900">
                          {formatPrice(g.revenue_mtd_cents)}
                        </p>
                        <p className="text-xs text-gray-400">Revenue (MTD)</p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-2">
                      <span className={activeInactiveBadgeClass(g.is_active)}>
                        {g.is_active ? "Active" : "Inactive"}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fullGroup && openEditModal(fullGroup)}
                          disabled={busy}
                          className={`${DS_SECONDARY_BTN} disabled:opacity-50`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => fullGroup && void deleteGroup(fullGroup)}
                          disabled={busy}
                          className="rounded-lg border border-red-100 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                        >
                          {busy ? "…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={openCreateModal}
                className={`${DS_CARD} flex flex-col items-center justify-center gap-2 border-dashed text-gray-400 hover:border-green-400 hover:text-green-600 transition-colors min-h-[180px]`}
              >
                <span className="text-2xl">+</span>
                <span className="text-sm font-medium">Create New Group</span>
                <span className="text-xs text-gray-400">
                  Build a custom patient group
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className={DS_CARD}>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-4">
              Group Insights
            </p>
            <div className="space-y-4">
              {insights.top_patients?.value && (
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50 text-sm">
                    👑
                  </span>
                  <div>
                    <p className="text-xs text-green-600 font-medium">
                      Top by Patients
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {insights.top_patients.value.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {insights.top_patients.value.patient_count} patients
                    </p>
                  </div>
                </div>
              )}
              {insights.top_appointments?.value && (
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm">
                    📅
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">
                      Most Appointments
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {insights.top_appointments.value.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {insights.top_appointments.value.appointments_mtd}{" "}
                      appointments (MTD)
                    </p>
                  </div>
                </div>
              )}
              {insights.top_revenue?.value && (
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-sm">
                    💰
                  </span>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">
                      Top Revenue
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {insights.top_revenue.value.name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {formatPrice(insights.top_revenue.value.revenue_mtd_cents)}{" "}
                      (MTD)
                    </p>
                  </div>
                </div>
              )}
              {!insights.top_patients &&
                !insights.top_appointments &&
                !insights.top_revenue && (
                  <p className="text-sm text-gray-400">No group data yet.</p>
                )}
            </div>
          </div>

          <div className={DS_CARD}>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-4">
              Group Distribution
            </p>
            {distribution.total > 0 ? (
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <ResponsiveContainer width={120} height={120}>
                    <PieChart>
                      <Pie
                        data={distribution.segments}
                        cx="50%"
                        cy="50%"
                        innerRadius={38}
                        outerRadius={55}
                        dataKey="count"
                        startAngle={90}
                        endAngle={-270}
                        strokeWidth={0}
                      >
                        {distribution.segments.map((s, i) => (
                          <Cell key={i} fill={s.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-bold text-gray-900">
                      {distribution.total}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      Total Patients
                    </span>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {distribution.segments.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ background: s.color }}
                        />
                        <span className="text-xs text-gray-600 truncate">
                          {s.name}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-gray-800 shrink-0">
                        {s.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                No patients in groups yet.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Recent Group Activity
        </h2>
        <div className={DS_TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Group</th>
                  <th className={DS_TH}>Activity</th>
                  <th className={`${DS_TH} text-right`}>Patients Affected</th>
                  <th className={DS_TH}>Date &amp; Time</th>
                  <th className={DS_TH}>Performed By</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-10 text-center text-sm text-gray-500"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : activity.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-10 text-center text-sm text-gray-500"
                    >
                      No recent activity.
                    </td>
                  </tr>
                ) : (
                  activity.map((row, i) => (
                    <tr key={i} className={DS_TR}>
                      <td className={DS_TD_PRIMARY}>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <span
                            className={colorDotClass(row.group_color)}
                            aria-hidden
                          />
                          {row.group_name}
                        </span>
                      </td>
                      <td className={DS_TD_PRIMARY}>{row.activity}</td>
                      <td
                        className={`${DS_TD_PRIMARY} text-right tabular-nums`}
                      >
                        {row.patients_affected}
                      </td>
                      <td className={`whitespace-nowrap ${DS_TD_PRIMARY}`}>
                        {formatTimestamp(row.timestamp)}
                      </td>
                      <td className={DS_TD_PRIMARY}>{row.performed_by}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitBusy) setModalOpen(false);
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
            role="dialog"
            aria-modal
            aria-labelledby="group-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="group-modal-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              {editingGroup ? "Edit Group" : "New Group"}
            </h2>
            <div className="space-y-4 pt-5">
              <label className="block text-sm font-medium text-gray-700">
                Name
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className={`mt-1 ${DS_INPUT}`}
                  required
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Description
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                  className={`mt-1 ${DS_INPUT}`}
                  placeholder="Optional"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Color
                <select
                  value={formColor}
                  onChange={(e) =>
                    setFormColor(normalizeColor(e.target.value))
                  }
                  className={`mt-1 ${DS_INPUT}`}
                >
                  {COLOR_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={formPriority}
                  onChange={(e) => setFormPriority(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-[var(--color-primary,#16A34A)] focus:ring-[var(--color-primary,#16A34A)]"
                />
                Mark as priority for smart routing
              </label>
              {editingGroup ? (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-[var(--color-primary,#16A34A)] focus:ring-[var(--color-primary,#16A34A)]"
                  />
                  Is Active
                </label>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={submitBusy}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitModal()}
                disabled={submitBusy}
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
              >
                {submitBusy
                  ? "Saving…"
                  : editingGroup
                    ? "Save changes"
                    : "Create group"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

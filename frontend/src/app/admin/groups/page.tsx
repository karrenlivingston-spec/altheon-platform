"use client";

import { useCallback, useEffect, useState } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  activeInactiveBadgeClass,
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

const API_BASE = "https://altheon-platform.onrender.com";

const COLOR_OPTIONS = [
  "gray",
  "green",
  "blue",
  "purple",
  "amber",
  "red",
] as const;

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

function normalizeColor(value: string): GroupColor {
  const c = value.trim().toLowerCase();
  return (COLOR_OPTIONS as readonly string[]).includes(c)
    ? (c as GroupColor)
    : "gray";
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

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
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
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

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
      await loadGroups();
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
      await loadGroups();
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
            Organize patients into groups for priority routing and reporting
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
        <div className="mt-6 rounded-2xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className={`${DS_TABLE_WRAP} mt-8`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Name</th>
                <th className={DS_TH}>Description</th>
                <th className={DS_TH}>Priority</th>
                <th className={DS_TH}>Status</th>
                <th className={`${DS_TH} text-right`}>Members</th>
                <th className={`${DS_TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-10 text-center text-sm text-gray-500"
                  >
                    Loading groups…
                  </td>
                </tr>
              ) : groups.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-10 text-center text-sm text-gray-500"
                  >
                    No groups yet. Create one to get started.
                  </td>
                </tr>
              ) : (
                groups.map((group) => {
                  const active = group.is_active !== false;
                  const busy = deletingId === group.id;
                  return (
                    <tr key={group.id} className={DS_TR}>
                      <td className={DS_TD_PRIMARY}>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <span
                            className={colorDotClass(group.color)}
                            aria-hidden
                          />
                          {group.name}
                        </span>
                      </td>
                      <td className={`${DS_TD_PRIMARY} max-w-xs`}>
                        <span className="line-clamp-2 text-gray-600">
                          {group.description?.trim() || "—"}
                        </span>
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {group.priority_flag ? (
                          <span className={PRIORITY_BADGE}>Priority</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <span className={activeInactiveBadgeClass(active)}>
                          {active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td
                        className={`${DS_TD_PRIMARY} text-right tabular-nums`}
                      >
                        {memberCounts[group.id] ?? 0}
                      </td>
                      <td
                        className={`${DS_TD_PRIMARY} whitespace-nowrap text-right`}
                      >
                        <button
                          type="button"
                          onClick={() => openEditModal(group)}
                          className={`${DS_SECONDARY_BTN} mr-2`}
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteGroup(group)}
                          disabled={busy}
                          className="rounded-lg border border-red-100 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                        >
                          {busy ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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

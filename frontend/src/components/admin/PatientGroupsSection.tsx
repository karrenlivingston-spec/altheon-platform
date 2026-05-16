"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DS_INPUT, DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";

type PatientGroupRow = {
  id: string;
  name: string;
  color?: string | null;
  priority_flag?: boolean | null;
};

type ClinicGroupRow = {
  id: string;
  name: string;
  color?: string | null;
  is_active?: boolean | null;
};

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
  return `h-2 w-2 shrink-0 rounded-full ${map[c] ?? map.gray}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export type PatientGroupsSectionProps = {
  clinicId: string;
  patientId: string;
};

export function PatientGroupsSection({
  clinicId,
  patientId,
}: PatientGroupsSectionProps) {
  const [groups, setGroups] = useState<PatientGroupRow[]>([]);
  const [clinicGroups, setClinicGroups] = useState<ClinicGroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [removeBusyId, setRemoveBusyId] = useState<string | null>(null);

  const loadPatientGroups = useCallback(async () => {
    if (!clinicId.trim() || !patientId.trim()) {
      setGroups([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/patients/${encodeURIComponent(patientId)}/groups?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) {
        setError(
          (await res.text().catch(() => "")).trim() ||
            `Could not load groups (${res.status})`,
        );
        setGroups([]);
        return;
      }
      const json: unknown = await res.json();
      setGroups(Array.isArray(json) ? (json as PatientGroupRow[]) : []);
    } catch {
      setError("Could not load groups.");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, patientId]);

  const loadClinicGroups = useCallback(async () => {
    if (!clinicId.trim()) {
      setClinicGroups([]);
      return;
    }
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/groups?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: h },
      );
      if (!res.ok) return;
      const json: unknown = await res.json();
      setClinicGroups(Array.isArray(json) ? (json as ClinicGroupRow[]) : []);
    } catch {
      setClinicGroups([]);
    }
  }, [clinicId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadPatientGroups();
    });
    return () => {
      cancelled = true;
    };
  }, [loadPatientGroups]);

  const memberIds = useMemo(
    () => new Set(groups.map((g) => g.id)),
    [groups],
  );

  const availableToAdd = useMemo(
    () =>
      clinicGroups.filter(
        (g) => !memberIds.has(g.id) && g.is_active !== false,
      ),
    [clinicGroups, memberIds],
  );

  async function openAddDropdown() {
    setError(null);
    const next = !addOpen;
    setAddOpen(next);
    if (next) await loadClinicGroups();
  }

  async function addToGroup(groupId: string) {
    if (!groupId || addBusy) return;
    setAddBusy(true);
    setError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/groups/${encodeURIComponent(groupId)}/members`,
        {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            patient_id: patientId,
            clinic_id: clinicId,
          }),
        },
      );
      if (!res.ok) {
        setError(
          (await res.text().catch(() => "")).trim() ||
            `Could not add to group (${res.status})`,
        );
        return;
      }
      setAddOpen(false);
      await loadPatientGroups();
      await loadClinicGroups();
    } catch {
      setError("Could not add to group.");
    } finally {
      setAddBusy(false);
    }
  }

  async function removeFromGroup(groupId: string) {
    if (removeBusyId) return;
    setRemoveBusyId(groupId);
    setError(null);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(patientId)}`,
        { method: "DELETE", headers: h },
      );
      if (!res.ok && res.status !== 204) {
        setError(
          (await res.text().catch(() => "")).trim() ||
            `Could not remove from group (${res.status})`,
        );
        return;
      }
      await loadPatientGroups();
    } catch {
      setError("Could not remove from group.");
    } finally {
      setRemoveBusyId(null);
    }
  }

  if (!clinicId.trim() || !patientId.trim()) {
    return null;
  }

  return (
    <div className="mt-10">
      <div className="rounded-[14px] border border-black/10 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06),0_4px_16px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-900">
            Groups
          </h2>
          <button
            type="button"
            onClick={() => void openAddDropdown()}
            disabled={addBusy}
            className={`${DS_SECONDARY_BTN} inline-flex items-center px-3 py-1.5 text-xs disabled:opacity-50`}
          >
            + Add to Group
          </button>
        </div>

        {error ? (
          <p className="border-b border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 sm:px-6">
            {error}
          </p>
        ) : null}

        <div className="px-4 py-4 sm:px-6">
          {loading ? (
            <p className="text-sm text-gray-500">Loading groups…</p>
          ) : groups.length === 0 && !addOpen ? (
            <p className="text-sm text-gray-500">
              Not in any groups yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => {
                const busy = removeBusyId === g.id;
                return (
                  <span
                    key={g.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-gray-800"
                  >
                    <span
                      className={colorDotClass(g.color)}
                      aria-hidden
                    />
                    {g.name}
                    {g.priority_flag ? (
                      <span className="text-[10px] font-normal uppercase tracking-wide text-green-700">
                        Priority
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeFromGroup(g.id)}
                      className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 disabled:opacity-50"
                      aria-label={`Remove from ${g.name}`}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {addOpen ? (
            <div className="mt-3 max-w-xs">
              <label className="sr-only" htmlFor="patient-add-group-select">
                Add to group
              </label>
              <select
                id="patient-add-group-select"
                disabled={addBusy}
                defaultValue=""
                className={`${DS_INPUT} text-sm disabled:opacity-50`}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) void addToGroup(id);
                  e.target.value = "";
                }}
              >
                <option value="" disabled>
                  {addBusy
                    ? "Adding…"
                    : availableToAdd.length === 0
                      ? "No groups available"
                      : "Select a group…"}
                </option>
                {availableToAdd.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

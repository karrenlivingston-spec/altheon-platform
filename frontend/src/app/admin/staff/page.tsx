"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  DS_DESTRUCTIVE_BTN,
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
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const INVITE_LINK_BASE = "https://altheon.app/accept-invite";

const STAFF_ROLES = [
  { value: "clinic_admin", label: "Clinic admin" },
  { value: "clinician", label: "Clinician" },
  { value: "front_desk", label: "Front desk" },
  { value: "biller", label: "Biller" },
] as const;

type StaffRow = {
  id: string;
  user_id: string;
  clinic_id: string;
  role: string;
  name: string;
  email: string;
  created_at?: string | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return value;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

function roleLabel(role: string): string {
  const match = STAFF_ROLES.find((r) => r.value === role);
  if (match) return match.label;
  if (role === "super_admin") return "Super admin";
  return role || "—";
}

export default function StaffManagementPage() {
  const router = useRouter();
  const { clinicId } = useClinic();
  const { canManageStaff, userId, loading: permissionsLoading } =
    usePermissions();

  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<(typeof STAFF_ROLES)[number]["value"]>("clinician");
  const [inviteBillingOnly, setInviteBillingOnly] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  useEffect(() => {
    if (permissionsLoading) return;
    if (!canManageStaff) {
      router.replace("/admin");
    }
  }, [canManageStaff, permissionsLoading, router]);

  const loadStaff = useCallback(async () => {
    if (!clinicId || !canManageStaff) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/staff?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        throw new Error(
          (await res.text().catch(() => "")).trim() ||
            `Failed to load staff (${res.status})`,
        );
      }
      const json = (await res.json()) as StaffRow[];
      setRows(Array.isArray(json) ? json : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, canManageStaff]);

  useEffect(() => {
    if (permissionsLoading || !canManageStaff) return;
    void loadStaff();
  }, [loadStaff, permissionsLoading, canManageStaff]);

  async function handleRoleChange(row: StaffRow, nextRole: string) {
    if (!clinicId || row.role === nextRole) return;
    setActionBusyId(row.user_id);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/staff/${encodeURIComponent(row.user_id)}/role?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify({ role: nextRole }),
        },
      );
      if (!res.ok) {
        throw new Error(
          (await res.text().catch(() => "")).trim() ||
            `Failed to update role (${res.status})`,
        );
      }
      await loadStaff();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleRemove(row: StaffRow) {
    if (!clinicId) return;
    const label = row.name || row.email || "this staff member";
    if (!window.confirm(`Remove ${label} from this clinic?`)) return;
    setActionBusyId(row.user_id);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/staff/${encodeURIComponent(row.user_id)}?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "DELETE",
          headers: await authHeaders(),
        },
      );
      if (!res.ok) {
        throw new Error(
          (await res.text().catch(() => "")).trim() ||
            `Failed to remove staff (${res.status})`,
        );
      }
      await loadStaff();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove staff");
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    const trimmedClinicId = (clinicId ?? "").trim();
    const { data: sessionData } = await supabase.auth.getSession();
    const invitedBy = (
      sessionData.session?.user?.id ??
      userId ??
      ""
    ).trim();
    const email = inviteEmail.trim();
    const payload = {
      clinic_id: trimmedClinicId,
      email,
      role: inviteRole,
      invited_by: invitedBy,
      billing_only: inviteRole === "biller" ? inviteBillingOnly : false,
    };

    console.log("[staff/invite] payload", { ...payload, invitedBy });

    if (!trimmedClinicId || !invitedBy) {
      setInviteError("Missing clinic or user context — cannot send invite");
      return;
    }
    if (!email) {
      setInviteError("Email is required.");
      return;
    }
    if (!STAFF_ROLES.some((r) => r.value === inviteRole)) {
      setInviteError("Invalid role selected.");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    setInviteToken(null);
    try {
      const res = await fetch(`${API_BASE}/staff/invite`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(
          (await res.text().catch(() => "")).trim() ||
            `Failed to create invite (${res.status})`,
        );
      }
      const json = (await res.json()) as { token?: string };
      setInviteToken(json.token ?? null);
      setInviteEmail("");
      await loadStaff();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteToken() {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteToken);
    } catch {
      setInviteError("Could not copy to clipboard.");
    }
  }

  function inviteLink(token: string): string {
    return `${INVITE_LINK_BASE}?token=${encodeURIComponent(token)}`;
  }

  async function copyInviteLink() {
    if (!inviteToken) return;
    try {
      await navigator.clipboard.writeText(inviteLink(inviteToken));
    } catch {
      setInviteError("Could not copy link to clipboard.");
    }
  }

  if (permissionsLoading || !canManageStaff) {
    return (
      <div className={DS_PAGE_ROOT}>
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={DS_PAGE_TITLE}>Staff Management</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Invite team members and manage clinic roles.
          </p>
        </div>
        <button
          type="button"
          className={DS_PRIMARY_BTN}
          onClick={() => {
            setInviteOpen(true);
            setInviteError(null);
            setInviteToken(null);
          }}
        >
          Invite Staff
        </button>
      </header>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className={DS_TABLE_WRAP}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Name</th>
                <th className={DS_TH}>Email</th>
                <th className={DS_TH}>Role</th>
                <th className={DS_TH}>Joined</th>
                <th className={DS_TH} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    Loading staff…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                    No staff members found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const isSelf = row.user_id === userId;
                  const isSuperAdmin = row.role === "super_admin";
                  const busy = actionBusyId === row.user_id;
                  return (
                    <tr key={row.id} className={DS_TR}>
                      <td className={DS_TD_PRIMARY}>{row.name}</td>
                      <td className={DS_TD_PRIMARY}>{row.email || "—"}</td>
                      <td className={DS_TD_PRIMARY}>
                        {isSuperAdmin ? (
                          <span className={membershipStatusBadgeClass(row.role)}>
                            {roleLabel(row.role)}
                          </span>
                        ) : (
                          <select
                            className={`${DS_INPUT} max-w-[180px]`}
                            value={row.role}
                            disabled={busy || isSelf}
                            onChange={(e) =>
                              void handleRoleChange(row, e.target.value)
                            }
                          >
                            {STAFF_ROLES.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                        {formatJoinedDate(row.created_at)}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <button
                          type="button"
                          className={`${DS_DESTRUCTIVE_BTN} disabled:opacity-50`}
                          disabled={busy || isSelf || isSuperAdmin}
                          onClick={() => void handleRemove(row)}
                        >
                          {busy ? "Removing…" : "Remove"}
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

      {inviteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[14px] border border-black/10 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Invite staff</h2>
            <p className="mt-1 text-sm text-gray-500">
              {inviteToken
                ? "Share this link with your new team member to complete their account setup."
                : "Enter the new team member's email and role to generate an invite link."}
            </p>
            {inviteError ? (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {inviteError}
              </p>
            ) : null}
            {inviteToken ? (
              <div className="mt-4 space-y-3">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Invite link
                </label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs break-all text-gray-800">
                  {inviteLink(inviteToken)}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={DS_SECONDARY_BTN}
                    onClick={() => void copyInviteLink()}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className={DS_SECONDARY_BTN}
                    onClick={() => void copyInviteToken()}
                  >
                    Copy token
                  </button>
                </div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Invite token
                </label>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs break-all text-gray-800">
                  {inviteToken}
                </div>
              </div>
            ) : (
              <form className="mt-4 space-y-4" onSubmit={(e) => void handleInvite(e)}>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    className={DS_INPUT}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                    Role
                  </label>
                  <select
                    className={DS_INPUT}
                    value={inviteRole}
                    onChange={(e) => {
                      const next = e.target
                        .value as (typeof STAFF_ROLES)[number]["value"];
                      setInviteRole(next);
                      if (next !== "biller") setInviteBillingOnly(false);
                    }}
                  >
                    {STAFF_ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                {inviteRole === "biller" ? (
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 rounded border-gray-300"
                      checked={inviteBillingOnly}
                      onChange={(e) => setInviteBillingOnly(e.target.checked)}
                    />
                    <span>
                      External billing company (billing only — no clinical note
                      access)
                    </span>
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={inviteBusy}
                    className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
                  >
                    {inviteBusy ? "Sending…" : "Send invite"}
                  </button>
                  <button
                    type="button"
                    disabled={inviteBusy}
                    className={DS_SECONDARY_BTN}
                    onClick={() => {
                      setInviteOpen(false);
                      setInviteError(null);
                      setInviteToken(null);
                    }}
                  >
                    Close
                  </button>
                </div>
              </form>
            )}
            {inviteToken ? (
              <div className="mt-4">
                <button
                  type="button"
                  className={DS_PRIMARY_BTN}
                  onClick={() => {
                    setInviteOpen(false);
                    setInviteToken(null);
                  }}
                >
                  Done
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_FILTER_BAR,
  DS_PAGE_ROOT,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import NewTaskModal from "@/components/admin/tasks/NewTaskModal";
import {
  API_BASE,
  authHeaders,
  formatTimeAgo,
  type StaffTask,
} from "@/lib/tasksMessaging";

function priorityBadgeClass(priority: string): string {
  return priority.toLowerCase() === "urgent"
    ? "inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800"
    : "inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700";
}

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "acknowledged":
      return "inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800";
    case "resolved":
      return "inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800";
    default:
      return "inline-flex rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-800";
  }
}

function statusLabel(status: string): string {
  if (status === "acknowledged") return "Acknowledged";
  if (status === "resolved") return "Resolved";
  return "Open";
}

function sourceBadge(source: string): React.ReactNode {
  const s = source.toLowerCase();
  if (s === "aria") {
    return (
      <span className="inline-flex rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
        Aria
      </span>
    );
  }
  if (s === "system") {
    return (
      <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
        System
      </span>
    );
  }
  return "—";
}

export default function AdminTasksPage() {
  const { clinicId } = useClinic();
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "resolved" | "all">("active");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "normal" | "urgent">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter === "resolved") {
        params.set("status", "resolved");
      } else if (statusFilter === "all") {
        params.set("status", "all");
      } else {
        params.set("status", "all");
      }
      if (priorityFilter !== "all") params.set("priority", priorityFilter);

      const res = await fetch(
        `${API_BASE}/tasks/${encodeURIComponent(clinicId)}?${params.toString()}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) throw new Error("Could not load tasks");
      let rows = (await res.json()) as StaffTask[];
      if (!Array.isArray(rows)) rows = [];
      if (statusFilter === "active") {
        rows = rows.filter((t) => t.status === "open" || t.status === "acknowledged");
      }
      setTasks(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, statusFilter, priorityFilter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function updateStatus(taskId: string, status: "acknowledged" | "resolved") {
    if (!clinicId) return;
    setBusyId(taskId);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/tasks/${encodeURIComponent(clinicId)}/${encodeURIComponent(taskId)}`,
        {
          method: "PATCH",
          headers: await authHeaders(true),
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Update failed");
      }
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className={DS_PAGE_TITLE}>Tasks</h1>
        <button type="button" className={DS_PRIMARY_BTN} onClick={() => setModalOpen(true)}>
          + New Task
        </button>
      </header>

      <div className={`${DS_FILTER_BAR} flex flex-wrap items-center gap-4`}>
        <label className="text-sm text-gray-700">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="ml-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="active">Open / In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Priority
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
            className="ml-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="all">All</option>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className={DS_TABLE_WRAP}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Title</th>
                <th className={DS_TH}>Priority</th>
                <th className={DS_TH}>Status</th>
                <th className={DS_TH}>Assigned To</th>
                <th className={DS_TH}>Patient</th>
                <th className={DS_TH}>Source</th>
                <th className={DS_TH}>Created</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-gray-500">
                    No tasks match these filters.
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id} className={DS_TR}>
                    <td className={DS_TD_PRIMARY}>
                      <div className="font-medium text-gray-900">{task.title}</div>
                      {task.description ? (
                        <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">
                          {task.description}
                        </div>
                      ) : null}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <span className={priorityBadgeClass(task.priority)}>{task.priority}</span>
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      <span className={statusBadgeClass(task.status)}>
                        {statusLabel(task.status)}
                      </span>
                    </td>
                    <td className={DS_TD_PRIMARY}>{task.assigned_to_name || "—"}</td>
                    <td className={DS_TD_PRIMARY}>
                      {task.patient_id ? (
                        <Link
                          href={`/admin/patients/${encodeURIComponent(task.patient_id)}`}
                          className="text-teal-700 hover:underline"
                        >
                          {task.patient_name || "View"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={DS_TD_PRIMARY}>{sourceBadge(task.source)}</td>
                    <td className={`${DS_TD_PRIMARY} whitespace-nowrap text-gray-600`}>
                      {task.created_at ? formatTimeAgo(task.created_at) : "—"}
                    </td>
                    <td className={DS_TD_PRIMARY}>
                      {task.status === "open" ? (
                        <button
                          type="button"
                          disabled={busyId === task.id}
                          className="text-sm font-medium text-teal-700 hover:text-teal-800 disabled:opacity-60"
                          onClick={() => void updateStatus(task.id, "acknowledged")}
                        >
                          {busyId === task.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Acknowledge"
                          )}
                        </button>
                      ) : null}
                      {task.status === "acknowledged" ? (
                        <button
                          type="button"
                          disabled={busyId === task.id}
                          className="text-sm font-medium text-teal-700 hover:text-teal-800 disabled:opacity-60"
                          onClick={() => void updateStatus(task.id, "resolved")}
                        >
                          {busyId === task.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Resolve"
                          )}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <NewTaskModal
        clinicId={clinicId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => void loadTasks()}
      />
    </div>
  );
}

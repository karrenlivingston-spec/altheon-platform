"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import { downloadResubmissionPackage } from "@/components/admin/billing/resubmissionDownload";
import { ClinicTaskRow } from "@/components/admin/dashboard/dashboardTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function priorityBadgeClass(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "urgent") return "bg-red-100 text-red-800";
  if (p === "high") return "bg-orange-100 text-orange-800";
  if (p === "low") return "bg-blue-100 text-blue-800";
  return "bg-gray-100 text-gray-700";
}

export default function AdminTasksPage() {
  const { clinicId } = useClinic();
  const [tasks, setTasks] = useState<ClinicTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("open");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ clinic_id: clinicId });
      if (statusFilter === "open") {
        /* default API returns open + in_progress */
      } else if (statusFilter === "all") {
        params.set("status", "all");
      } else {
        params.set("status", statusFilter);
      }
      if (priorityFilter !== "all") params.set("priority", priorityFilter);
      if (typeFilter !== "all") params.set("task_type", typeFilter);

      const res = await fetch(`${API_BASE}/api/clinic-tasks?${params.toString()}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("Could not load tasks");
      const rows = (await res.json()) as ClinicTaskRow[];
      setTasks(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, statusFilter, priorityFilter, typeFilter]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function markDone(taskId: string) {
    setBusyId(taskId);
    try {
      const h = await authHeaders(true);
      const res = await fetch(
        `${API_BASE}/api/clinic-tasks/${encodeURIComponent(taskId)}?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "PATCH",
          headers: h,
          body: JSON.stringify({ status: "completed" }),
        },
      );
      if (!res.ok) throw new Error("Update failed");
      await loadTasks();
    } finally {
      setBusyId(null);
    }
  }

  async function prepareResubmission(task: ClinicTaskRow) {
    if (
      !clinicId ||
      !task.patient_id ||
      !task.claim_id ||
      !task.eob_extraction_id
    ) {
      return;
    }
    setPreparingId(task.id);
    try {
      const h = await authHeaders(true);
      await downloadResubmissionPackage({
        clinicId,
        patientId: task.patient_id,
        claimId: task.claim_id,
        eobExtractionId: task.eob_extraction_id,
        authHeaders: h,
      });
      await loadTasks();
    } finally {
      setPreparingId(null);
    }
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <header className="mb-6">
        <h1 className={DS_PAGE_TITLE}>Tasks</h1>
        <p className={DS_PAGE_SUBTITLE}>
          Persistent clinic tasks from EOB processing and other workflows.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-3">
        <label className="text-sm text-gray-700">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="ml-2 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          >
            <option value="open">Open / In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Priority
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="ml-2 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="text-sm text-gray-700">
          Type
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="ml-2 rounded-lg border border-gray-200 px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="eob_resubmission">EOB resubmission</option>
            <option value="general">General</option>
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
                <th className={DS_TH}>Type</th>
                <th className={DS_TH}>Patient</th>
                <th className={DS_TH}>Created</th>
                <th className={DS_TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-500">
                    No tasks match these filters.
                  </td>
                </tr>
              ) : (
                tasks.map((task) => {
                  const canPrepare =
                    task.task_type === "eob_resubmission" &&
                    Boolean(
                      task.claim_id && task.patient_id && task.eob_extraction_id,
                    );
                  return (
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
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${priorityBadgeClass(task.priority)}`}
                        >
                          {task.priority}
                        </span>
                      </td>
                      <td className={DS_TD_PRIMARY}>{task.task_type || "—"}</td>
                      <td className={DS_TD_PRIMARY}>
                        {task.patient_id ? (
                          <Link
                            href={`/admin/patients/${encodeURIComponent(task.patient_id)}`}
                            className="text-teal-700 hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                        {task.created_at
                          ? new Date(task.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <div className="flex flex-wrap gap-2">
                          {canPrepare ? (
                            <button
                              type="button"
                              disabled={preparingId === task.id}
                              className="text-teal-700 hover:underline disabled:opacity-60"
                              onClick={() => void prepareResubmission(task)}
                            >
                              {preparingId === task.id ? (
                                <span className="inline-flex items-center gap-1">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Generating…
                                </span>
                              ) : (
                                "Prepare Resubmission"
                              )}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busyId === task.id}
                            className="text-gray-700 hover:text-gray-900 disabled:opacity-60"
                            onClick={() => void markDone(task.id)}
                          >
                            {busyId === task.id ? "Saving…" : "Mark Done"}
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
    </div>
  );
}

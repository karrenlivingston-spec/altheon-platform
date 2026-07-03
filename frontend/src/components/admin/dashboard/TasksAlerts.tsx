"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ChevronRight, Loader2 } from "lucide-react";

import { useClinic } from "@/app/admin/ClinicContext";
import { DS_CARD } from "@/app/admin/designSystem";
import ResubmissionTaskActions from "@/components/admin/billing/ResubmissionTaskActions";
import {
  ClinicTaskRow,
  DashboardSummary,
} from "@/components/admin/dashboard/dashboardTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type TasksAlertsProps = {
  data: DashboardSummary;
  onRefresh?: () => void;
};

type TaskRow = {
  icon: string;
  label: string;
  count: number;
  href: string;
  badgeClass: string;
};

function priorityBadgeClass(priority: string): string {
  const p = priority.toLowerCase();
  if (p === "urgent") return "bg-red-100 text-red-800";
  if (p === "high") return "bg-orange-100 text-orange-800";
  if (p === "low") return "bg-blue-100 text-blue-800";
  return "bg-gray-100 text-gray-700";
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export default function TasksAlerts({ data, onRefresh }: TasksAlertsProps) {
  const { clinicId } = useClinic();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const claimsNeed =
    data.claims_requiring_action.denied.count +
    data.claims_requiring_action.pending.count;

  const clinicTasks = data.tasks.clinic_tasks ?? [];
  const eobResubmission = data.tasks.eob_resubmission ?? 0;

  const rows: TaskRow[] = [
    {
      icon: "👤",
      label: "patient intakes incomplete",
      count: data.tasks.incomplete_intakes,
      href: "/admin/tasks?type=incomplete_intake",
      badgeClass: "bg-amber-100 text-amber-800",
    },
    {
      icon: "📄",
      label: "claims need attention",
      count: claimsNeed,
      href: "/admin/billing",
      badgeClass: "bg-red-100 text-red-700",
    },
    {
      icon: "📝",
      label: "notes need review & signature",
      count: data.tasks.notes_review,
      href: "/admin/tasks?type=note_review",
      badgeClass: "bg-amber-100 text-amber-800",
    },
    {
      icon: "⚖️",
      label: "legal requests in progress",
      count: data.tasks.legal_in_progress,
      href: "/admin/tasks?type=legal_request",
      badgeClass: "bg-blue-100 text-blue-800",
    },
    {
      icon: "📅",
      label: "appointments need confirmation",
      count: data.tasks.unconfirmed_appointments,
      href: "/admin/tasks?type=unconfirmed_appointment",
      badgeClass: "bg-gray-100 text-gray-700",
    },
  ];

  if (eobResubmission > 0) {
    rows.push({
      icon: "📋",
      label: "EOB resubmissions required",
      count: eobResubmission,
      href: "/admin/billing",
      badgeClass: "bg-red-100 text-red-800",
    });
  }

  const computedTotal = rows.reduce((a, r) => a + r.count, 0);
  const extraPersistentTasks = clinicTasks.filter(
    (t) => t.task_type !== "eob_resubmission",
  ).length;
  const total = computedTotal + extraPersistentTasks;

  async function markTaskDone(taskId: string) {
    if (!clinicId) return;
    setBusyTaskId(taskId);
    setActionError(null);
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
      if (!res.ok) {
        throw new Error("Could not update task");
      }
      onRefresh?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not update task");
    } finally {
      setBusyTaskId(null);
    }
  }

  function renderClinicTask(task: ClinicTaskRow) {
    const canPrepare =
      task.task_type === "eob_resubmission" &&
      Boolean(task.claim_id && task.patient_id && task.eob_extraction_id);
    const isCompleted =
      task.resubmission_submitted ||
      task.status === "completed" ||
      Boolean(task.resubmission_claim_id);

    return (
      <li key={task.id} className="py-3">
        <div className="flex flex-wrap items-start gap-3 text-sm">
          <span className="text-lg" aria-hidden>
            📌
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-900">{task.title}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${priorityBadgeClass(task.priority)}`}
              >
                {task.priority}
              </span>
              {isCompleted ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                  Completed
                </span>
              ) : null}
            </div>
            {task.description ? (
              <p className="mt-1 line-clamp-2 text-gray-600">{task.description}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {task.patient_id ? (
                <Link
                  href={`/admin/patients/${encodeURIComponent(task.patient_id)}`}
                  className="text-teal-700 hover:underline"
                >
                  View patient →
                </Link>
              ) : null}
            </div>
            {canPrepare ? (
              <ResubmissionTaskActions
                task={task}
                clinicId={clinicId}
                authHeaders={authHeaders}
                onUpdated={onRefresh}
                layout="stack"
              />
            ) : null}
            {!isCompleted ? (
              <button
                type="button"
                disabled={busyTaskId === task.id}
                className="mt-2 inline-flex items-center gap-1 text-gray-700 hover:text-gray-900 disabled:opacity-60"
                onClick={() => void markTaskDone(task.id)}
              >
                {busyTaskId === task.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span aria-hidden>✓</span>
                )}
                Mark Done
              </button>
            ) : null}
          </div>
        </div>
      </li>
    );
  }

  return (
    <div className={DS_CARD}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Tasks & Alerts</h2>
        <Link
          href="/admin/tasks"
          className="text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          View All →
        </Link>
      </div>

      {actionError ? (
        <p className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-800">
          {actionError}
        </p>
      ) : null}

      {total === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500" aria-hidden />
          <p className="text-sm font-medium text-green-700">
            All caught up! No tasks pending.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((row) =>
            row.count > 0 ? (
              <li key={row.label}>
                <Link
                  href={row.href}
                  className="flex items-center gap-3 py-3 text-sm hover:bg-gray-50"
                >
                  <span className="text-lg" aria-hidden>
                    {row.icon}
                  </span>
                  <span className="flex-1 text-gray-700">
                    <span className="font-semibold text-gray-900">{row.count}</span>{" "}
                    {row.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.badgeClass}`}
                  >
                    {row.count}
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />
                </Link>
              </li>
            ) : null,
          )}
          {clinicTasks.map((task) => renderClinicTask(task))}
        </ul>
      )}
    </div>
  );
}

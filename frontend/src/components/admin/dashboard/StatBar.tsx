"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  DollarSign,
  Phone,
  Users,
  ClipboardList,
} from "lucide-react";

import {
  DashboardSummary,
  formatUsdFromCents,
} from "@/components/admin/dashboard/dashboardTypes";
import { usePermissions } from "@/hooks/usePermissions";

type StatBarProps = {
  data: DashboardSummary | null;
  loading: boolean;
};

function StatCard({
  icon: Icon,
  value,
  label,
  sub,
  subClass,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  sub: string;
  subClass: string;
  href?: string;
}) {
  const inner = (
    <>
      <Icon className="absolute right-4 top-4 h-5 w-5 text-gray-300" aria-hidden />
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
      <p className={`mt-1 text-xs ${subClass}`}>{sub}</p>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="relative block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {inner}
    </div>
  );
}

export default function StatBar({ data, loading }: StatBarProps) {
  const { canViewBilling } = usePermissions();

  if (loading || !data) {
    return (
      <div
        className={`grid grid-cols-2 gap-4 ${canViewBilling ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-2"}`}
      >
        {Array.from({ length: canViewBilling ? 6 : 2 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  const upcoming = data.upcoming_appointments.length;
  const weekDelta = data.patients_this_week - data.patients_last_week;
  const weekSub =
    weekDelta >= 0
      ? `+${weekDelta} vs last week`
      : `${weekDelta} vs last week`;
  const weekClass = weekDelta >= 0 ? "text-green-600" : "text-red-600";

  const openTasks =
    data.tasks.incomplete_intakes +
    data.tasks.notes_review +
    data.tasks.legal_in_progress +
    data.tasks.unconfirmed_appointments +
    (data.tasks.clinic_tasks_open ?? 0);
  const claimsNeed =
    data.claims_requiring_action.denied.count +
    data.claims_requiring_action.pending.count;

  const pendingCents = Math.max(
    0,
    data.total_billed_mtd_cents - data.collections_mtd_cents,
  );

  return (
    <div
      className={`grid grid-cols-2 gap-4 ${canViewBilling ? "md:grid-cols-3 xl:grid-cols-6" : "md:grid-cols-2"}`}
    >
      <StatCard
        icon={Calendar}
        value={String(data.appointments_today)}
        label="Appointments Today"
        sub={`${upcoming} upcoming`}
        subClass="text-green-600"
      />
      <StatCard
        icon={Users}
        value={String(data.patients_this_week)}
        label="Patients This Week"
        sub={weekSub}
        subClass={weekClass}
      />
      {canViewBilling ? (
        <>
          <StatCard
            icon={ClipboardList}
            value={String(openTasks)}
            label="Open Tasks"
            sub={
              openTasks > 0 ? `${openTasks} require attention` : "All clear"
            }
            subClass={openTasks > 0 ? "text-amber-600" : "text-gray-500"}
            href="/admin/tasks"
          />
          <StatCard
            icon={DollarSign}
            value={formatUsdFromCents(data.collections_mtd_cents)}
            label="Collections MTD"
            sub={
              pendingCents > 0
                ? `${formatUsdFromCents(pendingCents)} pending`
                : "Fully collected"
            }
            subClass={pendingCents > 0 ? "text-amber-600" : "text-gray-500"}
          />
          <StatCard
            icon={AlertTriangle}
            value={String(claimsNeed)}
            label="Claims At Risk"
            sub={claimsNeed > 0 ? "Action needed" : "No issues"}
            subClass={claimsNeed > 0 ? "text-red-600" : "text-gray-500"}
          />
          <StatCard
            icon={Phone}
            value={String(data.aria.calls_today)}
            label="Calls Today (Aria)"
            sub={`${data.aria.booked_today} booked · ${data.aria.missed_today} missed`}
            subClass="text-gray-500"
          />
        </>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { ChevronRight, Pencil } from "lucide-react";

import { DS_CARD, DS_PRIMARY_BTN, DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import {
  PatientHeaderStats,
  PatientRecord,
  formatDob,
  formatUsdFromCents,
  fullAddress,
  patientDisplayName,
  referralSourceLabel,
  relativeActivityTime,
} from "@/components/admin/patients/patientTypes";

type PatientOverviewTabProps = {
  patient: PatientRecord;
  stats: PatientHeaderStats;
  onEditProfile: () => void;
  readOnly?: boolean;
};

function statusDot(status: string) {
  const s = status.toLowerCase();
  if (s === "confirmed" || s === "checked_in") return "bg-green-500";
  if (s === "no_show" || s === "cancelled") return "bg-red-500";
  return "bg-gray-400";
}

export default function PatientOverviewTab({
  patient,
  stats,
  onEditProfile,
  readOnly = false,
}: PatientOverviewTabProps) {
  const { clinical_summary: cs, account_summary: ac } = stats;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <div className={DS_CARD}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Patient Overview</h2>
            {!readOnly ? (
              <button
                type="button"
                onClick={onEditProfile}
                className="inline-flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </button>
            ) : null}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Personal Information
              </h3>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-gray-500">Full Name</dt>
                  <dd className="font-medium text-gray-900">{patientDisplayName(patient)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Date of Birth</dt>
                  <dd className="text-gray-900">{formatDob(patient.date_of_birth)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Gender</dt>
                  <dd className="text-gray-900">{patient.gender?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Phone</dt>
                  <dd className="text-gray-900">{patient.phone?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Email</dt>
                  <dd className="text-gray-900">{patient.email?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Address</dt>
                  <dd className="text-gray-900">{fullAddress(patient)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Referral Source</dt>
                  <dd className="text-gray-900">
                    {referralSourceLabel(patient.referral_source)}
                  </dd>
                </div>
              </dl>
            </div>
            <div>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Insurance Information
              </h3>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-gray-500">Primary Insurance</dt>
                  <dd className="text-gray-900">{patient.insurance_carrier?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Policy Number</dt>
                  <dd className="text-gray-900">
                    {patient.insurance_policy_number?.trim() || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Group Number</dt>
                  <dd className="text-gray-900">
                    {patient.insurance_group_number?.trim() || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Subscriber</dt>
                  <dd className="text-gray-900">{patientDisplayName(patient)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Relationship</dt>
                  <dd className="text-gray-900">Self</dd>
                </div>
              </dl>
              <Link
                href="/admin/billing"
                className="mt-4 inline-block text-sm font-medium text-teal-600 hover:text-teal-700"
              >
                View Insurance Details →
              </Link>
            </div>
          </div>
        </div>

        <div className={DS_CARD}>
          <h2 className="mb-4 text-base font-semibold text-gray-900">Clinical Summary</h2>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
            {[
              ["Primary Complaint", cs.primary_complaint],
              ["Treating Provider", cs.treating_provider],
              ["Care Plan", cs.care_plan],
              ["Last Treatment", cs.last_treatment],
              ["Outcome Score", cs.outcome_score],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="mt-1 font-medium text-gray-900">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={DS_CARD}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Tags</h2>
            <button type="button" className={DS_SECONDARY_BTN}>
              + Add Tag
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {stats.tags.length === 0 ? (
              <p className="text-sm text-gray-500">No tags yet</p>
            ) : (
              stats.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800"
                >
                  {tag}
                </span>
              ))
            )}
          </div>
        </div>

        <div className={DS_CARD}>
          <h2 className="mb-4 text-base font-semibold text-gray-900">Recent Activity</h2>
          {stats.recent_activity.length === 0 ? (
            <p className="text-sm text-gray-500">No recent activity</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {stats.recent_activity.map((item, i) => (
                <li key={`${item.timestamp}-${i}`}>
                  <Link
                    href={item.link_to}
                    className="flex items-center gap-3 py-3 text-sm hover:bg-gray-50"
                  >
                    <span className="w-28 shrink-0 text-xs text-gray-500">
                      {relativeActivityTime(item.timestamp)}
                    </span>
                    <span className="min-w-0 flex-1 text-gray-900">{item.description}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {item.badge}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-6 xl:col-span-2">
        <div className={DS_CARD}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Upcoming Appointments</h2>
            <Link
              href="/admin/appointments"
              className="text-xs font-medium text-teal-600 hover:text-teal-700"
            >
              View Calendar →
            </Link>
          </div>
          {stats.upcoming_appointments.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming appointments</p>
          ) : (
            <ul className="space-y-3">
              {stats.upcoming_appointments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2"
                >
                  <div className="rounded-lg bg-teal-50 px-2 py-1 text-center text-xs">
                    <p className="font-semibold uppercase text-teal-800">
                      {a.month_label?.split(" ")[0] ?? "—"}
                    </p>
                    <p className="font-bold text-teal-900">
                      {a.month_label?.split(" ")[1] ?? ""}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{a.time_label}</p>
                    <p className="truncate text-xs text-gray-600">{a.treatment_type}</p>
                    <p className="truncate text-xs text-gray-500">{a.clinician_name}</p>
                  </div>
                  <span className={`h-2.5 w-2.5 rounded-full ${statusDot(a.status)}`} />
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/admin/appointments"
            className="mt-4 inline-block text-sm font-medium text-teal-600 hover:text-teal-700"
          >
            View All Appointments →
          </Link>
        </div>

        <div className={DS_CARD}>
          <h2 className="mb-4 text-base font-semibold text-gray-900">Account Summary</h2>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">Total Balance</dt>
              <dd
                className={`font-semibold ${
                  ac.total_balance_cents > 0 ? "text-red-600" : "text-gray-900"
                }`}
              >
                {formatUsdFromCents(ac.total_balance_cents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Insurance Balance</dt>
              <dd className="font-medium text-gray-900">
                {formatUsdFromCents(ac.insurance_balance_cents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-600">Patient Balance</dt>
              <dd className="font-medium text-gray-900">
                {formatUsdFromCents(ac.patient_balance_cents)}
              </dd>
            </div>
          </dl>
          <button type="button" className={`${DS_PRIMARY_BTN} mt-4 w-full`}>
            Make a Payment
          </button>
          <Link
            href="/admin/billing"
            className="mt-3 block text-center text-sm font-medium text-teal-600 hover:text-teal-700"
          >
            View Statement →
          </Link>
        </div>

        <div className={DS_CARD}>
          <h2 className="mb-3 text-base font-semibold text-gray-900">Quick Actions</h2>
          <ul className="divide-y divide-gray-100">
            {[
              ["New Clinical Note", "/admin/clinical-notes"],
              ["Send Intake Forms", "/admin/patients"],
              ["Verify Insurance", "/admin/billing"],
              ["View Documents", "#"],
            ].map(([label, href]) => (
              <li key={label}>
                <Link
                  href={href}
                  className="flex items-center justify-between py-3 text-sm font-medium text-gray-800 hover:text-teal-700"
                >
                  {label}
                  <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

"use client";

import { ChevronDown, MoreHorizontal, Phone } from "lucide-react";

import { DS_PRIMARY_BTN, DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import {
  PatientRecord,
  ageFromDob,
  formatDob,
  fullAddress,
  patientDisplayName,
  patientInitials,
} from "@/components/admin/patients/patientTypes";

type PatientHeaderProps = {
  patient: PatientRecord;
  patientDisplayId: string;
  onEditProfile: () => void;
  editMode?: boolean;
  onSave?: () => void;
  onCancel?: () => void;
  saveBusy?: boolean;
};

export default function PatientHeader({
  patient,
  patientDisplayId,
  onEditProfile,
  editMode,
  onSave,
  onCancel,
  saveBusy,
}: PatientHeaderProps) {
  const age = ageFromDob(patient.date_of_birth);
  const dobLine = [
    `DOB ${formatDob(patient.date_of_birth)}`,
    age !== null ? `(${age})` : null,
    patient.gender?.trim() || null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-4 px-6 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-teal-50 text-lg font-semibold text-teal-700">
            {patientInitials(patient)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                {patientDisplayName(patient)}
              </h1>
              <span className="text-sm text-gray-500">ID: {patientDisplayId}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{dobLine}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">
              <Phone className="h-4 w-4 text-gray-400" aria-hidden />
              {patient.phone?.trim() || "—"} (Mobile)
            </p>
            <p className="mt-0.5 text-sm text-gray-600">
              {patient.email?.trim() || "—"}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">{fullAddress(patient)}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {editMode ? (
            <>
              <button
                type="button"
                disabled={saveBusy}
                onClick={onSave}
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
              >
                {saveBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saveBusy}
                onClick={onCancel}
                className={DS_SECONDARY_BTN}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onEditProfile} className={DS_SECONDARY_BTN}>
                Edit Profile
              </button>
              <button type="button" className={`${DS_PRIMARY_BTN} inline-flex items-center gap-1`}>
                + New Appointment
                <ChevronDown className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                aria-label="More actions"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

import {
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  formatDob,
  patientDisplayName,
} from "@/components/admin/patients/patientTypes";
import type { PossibleDuplicateMatch } from "@/components/admin/patients/createPatientApi";

type DuplicatePhoneWarningProps = {
  matches: PossibleDuplicateMatch[];
  busy?: boolean;
  /** When true, staff can pick an existing patient (booking flow). */
  allowSelectExisting?: boolean;
  onSelectExisting?: (match: PossibleDuplicateMatch) => void;
  onSamePersonWithoutSelect?: () => void;
  onCreateAnyway: () => void;
};

export default function DuplicatePhoneWarning({
  matches,
  busy = false,
  allowSelectExisting = false,
  onSelectExisting,
  onSamePersonWithoutSelect,
  onCreateAnyway,
}: DuplicatePhoneWarningProps) {
  const [pickExisting, setPickExisting] = useState(false);

  function handleSamePerson() {
    if (allowSelectExisting && onSelectExisting) {
      if (matches.length === 1) {
        onSelectExisting(matches[0]);
        return;
      }
      setPickExisting(true);
      return;
    }
    onSamePersonWithoutSelect?.();
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">
        A patient with this phone number already exists
        {matches.length > 1 ? ` (${matches.length} records)` : ""}:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {matches.map((match) => (
          <li key={match.id}>
            {patientDisplayName(match)}, DOB {formatDob(match.date_of_birth)}
          </li>
        ))}
      </ul>

      {pickExisting && allowSelectExisting && onSelectExisting ? (
        <div className="mt-3 space-y-2 border-t border-amber-200/80 pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
            Select existing patient
          </p>
          <div className="flex flex-wrap gap-2">
            {matches.map((match) => (
              <button
                key={match.id}
                type="button"
                disabled={busy}
                className={`${DS_SECONDARY_BTN} text-xs`}
                onClick={() => onSelectExisting(match)}
              >
                {patientDisplayName(match)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className={DS_SECONDARY_BTN}
          onClick={handleSamePerson}
        >
          This is the same person
        </button>
        <button
          type="button"
          disabled={busy}
          className={DS_PRIMARY_BTN}
          onClick={onCreateAnyway}
        >
          {busy ? "Creating…" : "Different person — create anyway"}
        </button>
      </div>
    </div>
  );
}

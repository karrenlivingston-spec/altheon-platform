"use client";

import { useEffect, useState } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  postCreatePatient,
  type CreatedPatient,
  type PossibleDuplicateMatch,
} from "@/components/admin/patients/createPatientApi";
import DuplicatePhoneWarning from "@/components/admin/patients/DuplicatePhoneWarning";
import { REFERRAL_SOURCE_OPTIONS } from "@/components/admin/patients/patientTypes";

export type { CreatedPatient } from "@/components/admin/patients/createPatientApi";

export type NewPatientModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (patient: CreatedPatient) => void;
};

export default function NewPatientModal({
  open,
  onClose,
  onCreated,
}: NewPatientModalProps) {
  const { clinicId } = useClinic();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [sport, setSport] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [duplicateMatches, setDuplicateMatches] = useState<
    PossibleDuplicateMatch[] | null
  >(null);

  useEffect(() => {
    if (!open) return;
    setFirstName("");
    setLastName("");
    setPhone("");
    setDateOfBirth("");
    setEmail("");
    setAddress("");
    setSport("");
    setReferralSource("");
    setError(null);
    setInfo(null);
    setDuplicateMatches(null);
    setBusy(false);
  }, [open]);

  function handleClose() {
    if (busy) return;
    onClose();
  }

  function buildBody(): Record<string, string> {
    const body: Record<string, string> = {
      clinic_id: clinicId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim(),
      date_of_birth: dateOfBirth.trim(),
    };
    if (email.trim()) body.email = email.trim();
    if (address.trim()) body.address_line1 = address.trim();
    if (sport.trim()) body.sport = sport.trim();
    if (referralSource.trim()) body.referral_source = referralSource.trim();
    return body;
  }

  async function submitCreate(confirmDuplicate = false) {
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !dateOfBirth.trim()) {
      setError("First name, last name, phone, and date of birth are required.");
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    if (!confirmDuplicate) {
      setDuplicateMatches(null);
    }

    const result = await postCreatePatient(buildBody(), confirmDuplicate);

    if (result.kind === "possible_duplicate") {
      setDuplicateMatches(result.matches);
      setBusy(false);
      return;
    }

    if (result.kind === "error") {
      setError(result.message);
      setBusy(false);
      return;
    }

    onCreated?.(result.patient);
    onClose();
    setBusy(false);
  }

  function handleSamePersonAcknowledged() {
    setDuplicateMatches(null);
    setInfo(
      "This patient already exists. Find and select them in the patient list instead of creating a new record.",
    );
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        role="dialog"
        aria-modal
        aria-labelledby="new-patient-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="new-patient-modal-title"
          className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
        >
          New Patient
        </h2>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {info ? (
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
            {info}
          </div>
        ) : null}

        {duplicateMatches?.length ? (
          <div className="mt-4">
            <DuplicatePhoneWarning
              matches={duplicateMatches}
              busy={busy}
              onSamePersonWithoutSelect={handleSamePersonAcknowledged}
              onCreateAnyway={() => void submitCreate(true)}
            />
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">
            First Name
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Last Name
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Phone
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            />
          </label>
          <label className="block text-sm font-medium text-gray-700">
            Date of Birth
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              required
            />
          </label>
          <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="Optional"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
            Address
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="Optional — street, city, state, zip"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
            Sport
            <input
              type="text"
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
              placeholder="Optional"
            />
          </label>
          <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
            How did you hear about us?
            <select
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
              className={`mt-1 ${DS_INPUT}`}
            >
              <option value="">Optional</option>
              {REFERRAL_SOURCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!duplicateMatches?.length ? (
          <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className={DS_SECONDARY_BTN}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitCreate(false)}
              disabled={busy}
              className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
            >
              {busy ? "Creating…" : "Create Patient"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

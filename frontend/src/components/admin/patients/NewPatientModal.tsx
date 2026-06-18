"use client";

import { useEffect, useState } from "react";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { REFERRAL_SOURCE_OPTIONS } from "@/components/admin/patients/patientTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type CreatedPatient = {
  id: string;
  first_name: string;
  last_name: string;
  [key: string]: unknown;
};

export type NewPatientModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (patient: CreatedPatient) => void;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

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
  const [referralSource, setReferralSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFirstName("");
    setLastName("");
    setPhone("");
    setDateOfBirth("");
    setEmail("");
    setAddress("");
    setReferralSource("");
    setError(null);
    setBusy(false);
  }, [open]);

  function handleClose() {
    if (busy) return;
    onClose();
  }

  async function handleSubmit() {
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !dateOfBirth.trim()) {
      setError("First name, last name, phone, and date of birth are required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        clinic_id: clinicId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        date_of_birth: dateOfBirth.trim(),
      };
      if (email.trim()) body.email = email.trim();
      if (address.trim()) body.address_line1 = address.trim();
      if (referralSource.trim()) body.referral_source = referralSource.trim();

      const res = await fetch(`${API_BASE}/patients`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail =
          json &&
          typeof json === "object" &&
          "detail" in json &&
          typeof (json as { detail: unknown }).detail === "string"
            ? (json as { detail: string }).detail
            : `Error ${res.status}`;
        setError(detail);
        return;
      }
      if (
        !json ||
        typeof json !== "object" ||
        !("id" in json) ||
        typeof (json as { id: unknown }).id !== "string"
      ) {
        setError("Patient created but response was invalid.");
        return;
      }
      onCreated?.(json as CreatedPatient);
      onClose();
    } catch {
      setError("Could not create patient. Please try again.");
    } finally {
      setBusy(false);
    }
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
            onClick={() => void handleSubmit()}
            disabled={busy}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {busy ? "Creating…" : "Create Patient"}
          </button>
        </div>
      </div>
    </div>
  );
}

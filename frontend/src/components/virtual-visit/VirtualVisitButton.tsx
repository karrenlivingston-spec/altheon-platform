"use client";

import { useState } from "react";

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const TEAL = "#0d9488";

export type VirtualVisitAppointment = {
  id: string;
  patient_id: string;
  clinician_id: string;
  clinic_id: string;
  patient_name: string;
  patient_phone: string;
  clinician_name: string;
  is_virtual?: boolean;
};

async function authHeaders(): Promise<Record<string, string>> {
  let { data } = await supabase.auth.getSession();
  let token = data.session?.access_token ?? "";
  if (!token) {
    await supabase.auth.refreshSession();
    ({ data } = await supabase.auth.getSession());
    token = data.session?.access_token ?? "";
  }
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

type VirtualVisitButtonProps = {
  appointment: VirtualVisitAppointment;
  onSuccess?: (message: string) => void;
  onError?: (message: string) => void;
};

export default function VirtualVisitButton({
  appointment,
  onSuccess,
  onError,
}: VirtualVisitButtonProps) {
  const [loading, setLoading] = useState(false);

  if (appointment.is_virtual !== true) {
    return null;
  }

  async function handleStart() {
    setLoading(true);
    try {
      const h = await authHeaders();
      const res = await fetch(
        `${API_BASE}/visits/create?clinic_id=${encodeURIComponent(appointment.clinic_id)}`,
        {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            appointment_id: appointment.id,
            clinic_id: appointment.clinic_id,
            patient_id: appointment.patient_id,
            clinician_id: appointment.clinician_id,
            patient_phone: appointment.patient_phone,
            patient_name: appointment.patient_name,
            clinician_name: appointment.clinician_name,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        onError?.(
          typeof json?.detail === "string"
            ? json.detail
            : "Could not start virtual visit",
        );
        return;
      }
      const clinicianUrl = String(json.clinician_join_url ?? "");
      if (clinicianUrl) {
        const url = new URL(clinicianUrl);
        url.searchParams.set("clinic_id", appointment.clinic_id);
        window.open(url.toString(), "_blank", "noopener,noreferrer");
      }
      onSuccess?.("Opening visit room…");
    } catch {
      onError?.("Could not start virtual visit");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleStart()}
      disabled={loading}
      className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      style={{ backgroundColor: TEAL }}
    >
      {loading ? "Starting…" : "Start Virtual Visit"}
    </button>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const TEAL = "#0d9488";

export type DeliveryMethod = "sms" | "email" | "both" | "copy";
type ReadyDeliveryMethod = "sms" | "email" | "both";

export type VirtualVisitAppointment = {
  id: string;
  patient_id: string;
  clinician_id: string;
  clinic_id: string;
  patient_name: string;
  patient_phone: string;
  patient_email?: string | null;
  clinician_name: string;
  is_virtual?: boolean;
};

export function virtualVisitInviteSentKey(roomId: string) {
  return `virtual_visit_invite_sent_${roomId}`;
}

const DELIVERY_OPTIONS: { value: DeliveryMethod; label: string }[] = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "both", label: "Both" },
  { value: "copy", label: "Copy Link" },
];

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

type CreateVisitResponse = {
  room_id?: string;
  video_link?: string;
  patient_join_url?: string;
  clinician_join_url?: string;
  detail?: string;
};

type ReadyResponse = {
  video_link?: string;
  sms_sent?: boolean;
  email_sent?: boolean;
  already_sent?: boolean;
  detail?: string;
};

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
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("sms");
  const [loading, setLoading] = useState(false);
  const [patientEmailOnFile, setPatientEmailOnFile] = useState(
    (appointment.patient_email ?? "").trim(),
  );
  const [patientEmailOverride, setPatientEmailOverride] = useState("");
  const [emailLookupDone, setEmailLookupDone] = useState(
    Boolean((appointment.patient_email ?? "").trim()),
  );
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [inlineSuccess, setInlineSuccess] = useState<string | null>(null);
  const [clinicianJoinUrl, setClinicianJoinUrl] = useState<string | null>(null);
  const [lastRoomId, setLastRoomId] = useState<string | null>(null);

  const needsEmail =
    deliveryMethod === "email" || deliveryMethod === "both";
  const effectiveEmail =
    patientEmailOnFile.trim() || patientEmailOverride.trim();

  useEffect(() => {
    if (!needsEmail) return;
    if ((appointment.patient_email ?? "").trim()) {
      setPatientEmailOnFile((appointment.patient_email ?? "").trim());
      setEmailLookupDone(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/patients/${encodeURIComponent(appointment.patient_id)}?clinic_id=${encodeURIComponent(appointment.clinic_id)}`,
          { headers: h },
        );
        const json = (await res.json().catch(() => ({}))) as {
          email?: string | null;
        };
        if (cancelled) return;
        setPatientEmailOnFile(String(json.email ?? "").trim());
      } catch {
        if (!cancelled) setPatientEmailOnFile("");
      } finally {
        if (!cancelled) setEmailLookupDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    needsEmail,
    appointment.patient_id,
    appointment.clinic_id,
    appointment.patient_email,
  ]);

  const createVisit = useCallback(async (): Promise<CreateVisitResponse> => {
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
    const json = (await res.json().catch(() => ({}))) as CreateVisitResponse;
    if (!res.ok) {
      throw new Error(
        typeof json.detail === "string"
          ? json.detail
          : "Could not create virtual visit",
      );
    }
    return json;
  }, [appointment]);

  async function openClinicianRoom(clinicianUrl: string, roomId: string) {
    const url = new URL(clinicianUrl);
    url.searchParams.set("clinic_id", appointment.clinic_id);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      url.searchParams.set("token", session.access_token);
    }
    sessionStorage.setItem(virtualVisitInviteSentKey(roomId), "1");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  function inviteSuccessMessage(
    method: ReadyDeliveryMethod,
    ready: ReadyResponse,
  ): string {
    const sms = Boolean(ready.sms_sent);
    const email = Boolean(ready.email_sent);
    if (method === "both") {
      if (sms && email) return "SMS & Email sent";
      if (sms) return "SMS sent (email could not be sent)";
      if (email) return "Email sent (SMS could not be sent)";
    }
    if (method === "email") return "Email sent";
    return "SMS sent";
  }

  async function handlePrimaryAction() {
    setInlineSuccess(null);
    setLoading(true);
    try {
      if (deliveryMethod === "copy") {
        const created = await createVisit();
        const link = String(
          created.video_link ?? created.patient_join_url ?? "",
        ).trim();
        if (!link) {
          onError?.("Could not generate visit link");
          return;
        }
        setGeneratedLink(link);
        onSuccess?.("Visit link generated");
        return;
      }

      const method = deliveryMethod as ReadyDeliveryMethod;
      if (needsEmail && !effectiveEmail) {
        onError?.("Enter a patient email to send the invite");
        return;
      }
      if (needsEmail && !effectiveEmail.includes("@")) {
        onError?.("Enter a valid email address");
        return;
      }

      const created = await createVisit();
      const roomId = String(created.room_id ?? "").trim();
      if (!roomId) {
        onError?.("Could not create virtual visit room");
        return;
      }

      const h = await authHeaders();
      const readyBody: {
        delivery_method: ReadyDeliveryMethod;
        patient_email?: string;
      } = { delivery_method: method };
      if (needsEmail && patientEmailOverride.trim()) {
        readyBody.patient_email = patientEmailOverride.trim();
      }

      const readyRes = await fetch(
        `${API_BASE}/visits/${encodeURIComponent(roomId)}/ready?clinic_id=${encodeURIComponent(appointment.clinic_id)}`,
        {
          method: "POST",
          headers: h,
          body: JSON.stringify(readyBody),
        },
      );
      const readyJson = (await readyRes.json().catch(() => ({}))) as ReadyResponse;
      if (!readyRes.ok) {
        onError?.(
          typeof readyJson.detail === "string"
            ? readyJson.detail
            : "Could not send invite",
        );
        return;
      }

      sessionStorage.setItem(virtualVisitInviteSentKey(roomId), "1");
      const message = inviteSuccessMessage(method, readyJson);
      setInlineSuccess(message);
      onSuccess?.(message);

      const joinUrl = String(created.clinician_join_url ?? "").trim();
      if (joinUrl) {
        setClinicianJoinUrl(joinUrl);
        setLastRoomId(roomId);
      }
    } catch (err) {
      onError?.(
        err instanceof Error ? err.message : "Could not complete action",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyLink() {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopyConfirm(true);
      window.setTimeout(() => setCopyConfirm(false), 2000);
    } catch {
      onError?.("Could not copy link");
    }
  }

  if (appointment.is_virtual !== true) {
    return null;
  }

  const primaryLabel =
    deliveryMethod === "copy"
      ? loading
        ? "Generating…"
        : "Generate Link"
      : loading
        ? "Sending…"
        : "Send Invite";

  return (
    <div className="space-y-3">
      <div
        className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5"
        role="group"
        aria-label="Invite delivery method"
      >
        {DELIVERY_OPTIONS.map((opt) => {
          const selected = deliveryMethod === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setDeliveryMethod(opt.value);
                setInlineSuccess(null);
                if (opt.value !== "copy") {
                  setGeneratedLink(null);
                  setCopyConfirm(false);
                }
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                selected
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              aria-pressed={selected}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {needsEmail ? (
        <div className="space-y-1.5">
          {!emailLookupDone ? (
            <p className="text-xs text-slate-500">Checking patient email…</p>
          ) : patientEmailOnFile ? (
            <p className="text-xs text-slate-500">
              Sending to: {patientEmailOnFile}
            </p>
          ) : (
            <>
              <p className="text-xs text-amber-700">
                No email on file — enter patient email:
              </p>
              <input
                type="email"
                value={patientEmailOverride}
                onChange={(e) => setPatientEmailOverride(e.target.value)}
                placeholder="patient@email.com"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0d9488] focus:outline-none focus:ring-1 focus:ring-[#0d9488]"
              />
            </>
          )}
        </div>
      ) : null}

      {generatedLink ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={generatedLink}
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
            aria-label="Visit link"
          />
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {copyConfirm ? "✓ Copied" : "Copy"}
          </button>
        </div>
      ) : null}

      {inlineSuccess ? (
        <p className="text-xs font-medium text-emerald-700">{inlineSuccess}</p>
      ) : null}

      <button
        type="button"
        onClick={() => void handlePrimaryAction()}
        disabled={loading}
        className="w-full rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        style={{ backgroundColor: TEAL }}
      >
        {primaryLabel}
      </button>

      {clinicianJoinUrl && lastRoomId ? (
        <button
          type="button"
          onClick={() => void openClinicianRoom(clinicianJoinUrl, lastRoomId)}
          className="w-full text-center text-xs font-medium text-[#0d9488] hover:underline"
        >
          Open visit room as clinician
        </button>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import PiBillingLineItemsField, {
  emptyLine,
  type LineFieldErrors,
  type LineItemDraft,
  validateLine,
} from "@/components/admin/billing/PiBillingLineItemsField";
import { usePiFeeSchedule } from "@/hooks/usePiFeeSchedule";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type PiBillingContext = {
  piCaseId: string;
  patientId: string;
  patientName: string;
  insuranceCarrier: string | null;
  claimNumber: string | null;
  clinicId: string;
};

type ClinicianOption = {
  id: string;
  first_name?: string;
  last_name?: string;
  title?: string;
};

type AppointmentOption = {
  id: string;
  patient_id: string;
  start_time: string;
  status?: string;
};

type CreatePiBillingModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  context: PiBillingContext | null;
};

type FieldErrors = {
  dateOfService?: string;
  lines?: Record<number, LineFieldErrors>;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function clinicianLabel(c: ClinicianOption): string {
  const n = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return c.title ? `${n}, ${c.title}` : n || "Provider";
}

function formatApptLabel(a: AppointmentOption): string {
  const d = a.start_time.slice(0, 10);
  const t = a.start_time.length > 11 ? a.start_time.slice(11, 16) : "";
  const status = a.status ? ` (${a.status})` : "";
  return `${d}${t ? ` ${t}` : ""}${status}`;
}

function parseApiError(json: unknown, fallback: string): string {
  if (
    json &&
    typeof json === "object" &&
    "detail" in json &&
    typeof (json as { detail: unknown }).detail === "string"
  ) {
    return (json as { detail: string }).detail;
  }
  return fallback;
}

export default function CreatePiBillingModal({
  open,
  onClose,
  onSuccess,
  context,
}: CreatePiBillingModalProps) {
  const [dateOfService, setDateOfService] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [clinicians, setClinicians] = useState<ClinicianOption[]>([]);
  const [appointments, setAppointments] = useState<AppointmentOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdRecordId, setCreatedRecordId] = useState<string | null>(null);
  const [savedLineIds, setSavedLineIds] = useState<Set<string>>(() => new Set());

  const { piRates } = usePiFeeSchedule(open ? context?.clinicId : null);

  useEffect(() => {
    if (!open) return;
    setDateOfService("");
    setAppointmentId("");
    setProviderId("");
    setNotes("");
    setLines([emptyLine()]);
    setFieldErrors({});
    setSubmitAttempted(false);
    setSubmitError(null);
    setBusy(false);
    setCreatedRecordId(null);
    setSavedLineIds(new Set());
  }, [open, context?.piCaseId]);

  useEffect(() => {
    if (!open || !context?.clinicId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(context.clinicId)}`,
          { headers: h },
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setClinicians(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setClinicians([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, context?.clinicId]);

  useEffect(() => {
    if (!open || !context?.clinicId || !context.patientId) {
      setAppointments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const h = await authHeaders();
        const res = await fetch(
          `${API_BASE}/appointments?clinic_id=${encodeURIComponent(context.clinicId)}`,
          { headers: h },
        );
        const data = res.ok ? await res.json() : [];
        const rows = (Array.isArray(data) ? data : []) as AppointmentOption[];
        const filtered = rows
          .filter(
            (a) =>
              a.patient_id === context.patientId &&
              String(a.status ?? "").toLowerCase() !== "cancelled",
          )
          .sort((a, b) => b.start_time.localeCompare(a.start_time))
          .slice(0, 15);
        if (!cancelled) setAppointments(filtered);
      } catch {
        if (!cancelled) setAppointments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, context?.clinicId, context?.patientId]);

  if (!open || !context) return null;

  function validate(): FieldErrors {
    const errs: FieldErrors = {};
    if (!dateOfService.trim()) errs.dateOfService = "Required.";
    const lineErrs: Record<number, LineFieldErrors> = {};
    lines.forEach((line, i) => {
      const rowErrs = validateLine(line);
      if (Object.keys(rowErrs).length > 0) lineErrs[i] = rowErrs;
    });
    if (Object.keys(lineErrs).length > 0) errs.lines = lineErrs;
    return errs;
  }

  function showErr(key: keyof Omit<FieldErrors, "lines">) {
    return submitAttempted && fieldErrors[key] ? (
      <p className="mt-1 text-xs text-red-600">{fieldErrors[key]}</p>
    ) : null;
  }

  function handleClose() {
    if (busy) return;
    onClose();
  }

  function lineLabel(line: LineItemDraft, index: number): string {
    const code = line.cptCode.trim() || `line ${index + 1}`;
    return `${code} (${line.units || "1"} unit${Number(line.units) === 1 ? "" : "s"})`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    setSubmitError(null);
    if (!context) {
      setSubmitError("Missing case context — please close and reopen this modal.");
      return;
    }
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      const h = await authHeaders();
      let recordId = createdRecordId;

      if (!recordId) {
        const recordBody: Record<string, unknown> = {
          clinic_id: context.clinicId,
          patient_id: context.patientId,
          pi_case_id: context.piCaseId,
          date_of_service: dateOfService.trim(),
          billing_type: "pi",
        };
        const carrier = (context.insuranceCarrier ?? "").trim();
        if (carrier) recordBody.insurance_carrier = carrier;
        const claim = (context.claimNumber ?? "").trim();
        if (claim) recordBody.claim_number = claim;
        if (appointmentId.trim()) recordBody.appointment_id = appointmentId.trim();
        if (providerId.trim()) recordBody.provider_id = providerId.trim();
        if (notes.trim()) recordBody.notes = notes.trim();

        const recordRes = await fetch(`${API_BASE}/billing-records`, {
          method: "POST",
          headers: h,
          body: JSON.stringify(recordBody),
        });

        if (!recordRes.ok) {
          const json: unknown = await recordRes.json().catch(() => ({}));
          setSubmitError(
            parseApiError(json, `Could not create billing record (${recordRes.status}).`),
          );
          return;
        }

        const recordJson = (await recordRes.json()) as { id?: string };
        recordId = String(recordJson.id ?? "").trim();
        if (!recordId) {
          setSubmitError("Billing record was created but no record id was returned.");
          return;
        }
        setCreatedRecordId(recordId);
      }

      const succeeded = new Set(savedLineIds);
      const failed: { lineId: string; label: string; detail: string }[] = [];

      for (const line of lines) {
        if (succeeded.has(line.id)) continue;

        const rateNum = Number(line.rate);
        const unitsNum = Number(line.units);

        const lineItemRes = await fetch(
          `${API_BASE}/billing-records/${encodeURIComponent(recordId)}/line-items`,
          {
            method: "POST",
            headers: h,
            body: JSON.stringify({
              cpt_code: line.cptCode.trim(),
              rate_cents: Math.round(rateNum * 100),
              units: unitsNum,
            }),
          },
        );

        if (!lineItemRes.ok) {
          const json: unknown = await lineItemRes.json().catch(() => ({}));
          failed.push({
            lineId: line.id,
            label: lineLabel(line, lines.indexOf(line)),
            detail: parseApiError(json, `Error ${lineItemRes.status}`),
          });
          continue;
        }

        succeeded.add(line.id);
      }

      setSavedLineIds(new Set(succeeded));

      if (failed.length > 0) {
        const savedLabels = lines
          .filter((line) => succeeded.has(line.id))
          .map((line, i) => lineLabel(line, i));
        const failedLines = failed
          .map((f) => `${f.label}: ${f.detail}`)
          .join("; ");
        setSubmitError(
          `Billing record ${recordId} — saved ${succeeded.size} of ${lines.length} line item(s).` +
            (savedLabels.length
              ? ` Saved: ${savedLabels.join(", ")}.`
              : "") +
            ` Failed: ${failedLines}.` +
            " Fix the failed row(s) and submit again to add the rest (the billing record will not be duplicated).",
        );
        return;
      }

      const count = lines.length;
      onSuccess(
        count === 1
          ? "Billing record created — view it on the patient's Billing tab."
          : `Billing record created with ${count} line items — view it on the patient's Billing tab.`,
      );
      onClose();
    } catch {
      setSubmitError("Could not create billing record.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className={`max-h-[92vh] w-full max-w-2xl overflow-y-auto ${DS_CARD}`}>
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <h2 className="text-lg font-semibold text-gray-900">Create Billing</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form className="mt-4 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
            <dl className="space-y-2">
              <div>
                <dt className="text-xs font-semibold uppercase text-gray-500">Patient</dt>
                <dd className="font-medium text-gray-900">{context.patientName || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-gray-500">Insurance Carrier</dt>
                <dd className="text-gray-900">{context.insuranceCarrier?.trim() || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-gray-500">Claim Number</dt>
                <dd className="text-gray-900">{context.claimNumber?.trim() || "—"}</dd>
              </div>
            </dl>
          </div>

          {createdRecordId ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Billing record <span className="font-mono">{createdRecordId}</span> was created. Submit
              again to add any remaining line items without creating a duplicate record.
            </p>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
              Date of Service
            </label>
            <input
              type="date"
              value={dateOfService}
              onChange={(e) => setDateOfService(e.target.value)}
              className={DS_INPUT}
              disabled={busy || Boolean(createdRecordId)}
              required
            />
            {showErr("dateOfService")}
          </div>

          {appointments.length > 0 ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
                Link Appointment
              </label>
              <select
                value={appointmentId}
                onChange={(e) => setAppointmentId(e.target.value)}
                className={DS_INPUT}
                disabled={busy || Boolean(createdRecordId)}
              >
                <option value="">None</option>
                {appointments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatApptLabel(a)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {clinicians.length > 0 ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">
                Provider
              </label>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className={DS_INPUT}
                disabled={busy || Boolean(createdRecordId)}
              >
                <option value="">None</option>
                {clinicians.map((c) => (
                  <option key={c.id} value={c.id}>
                    {clinicianLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-gray-500">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={DS_INPUT}
              placeholder="Optional"
              disabled={busy || Boolean(createdRecordId)}
            />
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <PiBillingLineItemsField
              lines={lines}
              onChange={setLines}
              fieldErrors={fieldErrors.lines}
              submitAttempted={submitAttempted}
              disabled={busy}
              piRates={piRates}
            />
          </div>

          {submitError ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
              {submitError}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button type="button" onClick={handleClose} disabled={busy} className={DS_SECONDARY_BTN}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={DS_PRIMARY_BTN}>
              {busy
                ? createdRecordId
                  ? "Saving line items…"
                  : "Creating…"
                : createdRecordId
                  ? "Add remaining line items"
                  : "Create Billing Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

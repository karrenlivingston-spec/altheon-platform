"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import {
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { downloadResubmissionPackage } from "@/components/admin/billing/resubmissionDownload";
import { submitElectronicResubmission } from "@/components/admin/billing/resubmissionSubmit";
import { ClinicTaskRow } from "@/components/admin/dashboard/dashboardTypes";

type ResubmissionTaskActionsProps = {
  task: ClinicTaskRow;
  clinicId: string;
  authHeaders: (json?: boolean) => Promise<Record<string, string>>;
  onUpdated?: () => void;
  layout?: "inline" | "stack";
};

export default function ResubmissionTaskActions({
  task,
  clinicId,
  authHeaders,
  onUpdated,
  layout = "inline",
}: ResubmissionTaskActionsProps) {
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState(task.eob_denial_reason ?? "");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(Boolean(task.resubmission_submitted));
  const [prepared, setPrepared] = useState(Boolean(task.resubmission_prepared));

  useEffect(() => {
    setSubmitted(Boolean(task.resubmission_submitted));
    setPrepared(Boolean(task.resubmission_prepared));
    if (!confirmOpen) {
      setReason(task.eob_denial_reason ?? "");
    }
  }, [
    task.resubmission_submitted,
    task.resubmission_prepared,
    task.eob_denial_reason,
    confirmOpen,
  ]);

  const canResubmit =
    task.task_type === "eob_resubmission" &&
    Boolean(task.claim_id && task.patient_id && task.eob_extraction_id);

  if (!canResubmit) return null;

  const isCompleted =
    submitted ||
    task.status === "completed" ||
    Boolean(task.resubmission_claim_id);

  async function downloadPdf() {
    if (!task.patient_id || !task.claim_id || !task.eob_extraction_id) return;
    setPreparing(true);
    setSubmitError(null);
    try {
      const h = await authHeaders(true);
      await downloadResubmissionPackage({
        clinicId,
        patientId: task.patient_id,
        claimId: task.claim_id,
        eobExtractionId: task.eob_extraction_id,
        authHeaders: h,
      });
      setPrepared(true);
      onUpdated?.();
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : "Could not generate resubmission package",
      );
    } finally {
      setPreparing(false);
    }
  }

  async function confirmSubmit() {
    if (!task.claim_id || !task.eob_extraction_id || !reason.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const h = await authHeaders(true);
      const result = await submitElectronicResubmission({
        claimId: task.claim_id,
        eobExtractionId: task.eob_extraction_id,
        resubmissionReason: reason.trim(),
        authHeaders: h,
      });
      if (!result.success) {
        setSubmitError(result.error || "Resubmission failed");
        return;
      }
      setSubmitted(true);
      setConfirmOpen(false);
      setSuccessMessage(
        `Claim resubmitted successfully — New claim # ${result.new_claim_number ?? "—"}`,
      );
      onUpdated?.();
    } finally {
      setSubmitting(false);
    }
  }

  const stack = layout === "stack";

  return (
    <div className={stack ? "mt-2 space-y-2" : "space-y-2"}>
      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          {successMessage}
        </p>
      ) : null}

      {submitError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Resubmission failed: {submitError}
        </p>
      ) : null}

      <div className={`flex flex-wrap items-center gap-2 ${stack ? "" : ""}`}>
        <button
          type="button"
          disabled={preparing}
          className={`${DS_SECONDARY_BTN} text-xs disabled:opacity-60`}
          onClick={() => void downloadPdf()}
        >
          {preparing ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Generating…
            </span>
          ) : (
            "Download PDF Package"
          )}
        </button>

        {isCompleted ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Submitted
          </span>
        ) : prepared ? (
          !confirmOpen ? (
            <button
              type="button"
              className={`${DS_PRIMARY_BTN} text-xs`}
              onClick={() => {
                setConfirmOpen(true);
                setSubmitError(null);
              }}
            >
              Submit Electronically
            </button>
          ) : null
        ) : null}
      </div>

      {confirmOpen && !isCompleted ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-900">
            Submit corrected claim to payer electronically?
          </p>
          <label className="mt-3 block text-xs font-medium text-gray-700">
            Resubmission reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className={`mt-1 ${DS_INPUT} text-sm`}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={submitting || !reason.trim()}
              className={`${DS_PRIMARY_BTN} text-xs disabled:opacity-60`}
              onClick={() => void confirmSubmit()}
            >
              {submitting ? "Submitting…" : "Confirm"}
            </button>
            <button
              type="button"
              disabled={submitting}
              className={`${DS_SECONDARY_BTN} text-xs disabled:opacity-60`}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

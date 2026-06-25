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
  const [downloadError, setDownloadError] = useState<string | null>(null);
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

  const denialReason = task.eob_denial_reason?.trim() || "—";

  async function downloadPdf() {
    if (!task.patient_id || !task.claim_id || !task.eob_extraction_id) return;
    setPreparing(true);
    setDownloadError(null);
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
      setDownloadError(
        e instanceof Error ? e.message : "Could not generate resubmission package",
      );
    } finally {
      setPreparing(false);
    }
  }

  function openSubmitModal() {
    setReason(task.eob_denial_reason ?? "");
    setSubmitError(null);
    setConfirmOpen(true);
  }

  function closeSubmitModal() {
    if (submitting) return;
    setConfirmOpen(false);
    setSubmitError(null);
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

      {downloadError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {downloadError}
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
          <button
            type="button"
            className={`${DS_PRIMARY_BTN} text-xs`}
            onClick={openSubmitModal}
          >
            Submit Electronically
          </button>
        ) : null}
      </div>

      {confirmOpen && !isCompleted ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal
            aria-labelledby="resubmit-modal-title"
          >
            <h2
              id="resubmit-modal-title"
              className="text-lg font-semibold text-gray-900"
            >
              Submit Claim Electronically
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              This will send a corrected 837P claim to the payer via Stedi.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Denial reason (from EOB)
                </p>
                <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap">
                  {denialReason}
                </div>
              </div>

              <label className="block text-sm font-medium text-gray-700">
                Resubmission reason
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                  className={`mt-1 ${DS_INPUT} text-sm`}
                />
              </label>

              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Ensure the clinical documentation supports this resubmission before
                submitting.
              </p>

              {submitError ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  Resubmission failed: {submitError}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                className={`${DS_SECONDARY_BTN} text-sm disabled:opacity-60`}
                onClick={closeSubmitModal}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || !reason.trim()}
                className={`${DS_PRIMARY_BTN} text-sm disabled:opacity-60`}
                onClick={() => void confirmSubmit()}
              >
                {submitting ? "Submitting…" : "Submit Electronically"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

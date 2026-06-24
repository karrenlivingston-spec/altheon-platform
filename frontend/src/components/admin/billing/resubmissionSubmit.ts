const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type ResubmitClaimResponse = {
  success: boolean;
  new_claim_id?: string;
  new_claim_number?: string;
  stedi_reference?: string;
  error?: string;
};

export async function submitElectronicResubmission(args: {
  claimId: string;
  eobExtractionId: string;
  resubmissionReason: string;
  authHeaders: Record<string, string>;
}): Promise<ResubmitClaimResponse> {
  try {
    const res = await fetch(
      `${API_BASE}/billing/claims/${encodeURIComponent(args.claimId)}/resubmit`,
      {
        method: "POST",
        headers: args.authHeaders,
        body: JSON.stringify({
          eob_extraction_id: args.eobExtractionId,
          resubmission_reason: args.resubmissionReason,
        }),
      },
    );
    const data = (await res.json().catch(() => ({}))) as ResubmitClaimResponse;
    if (!data.success) {
      return {
        success: false,
        error:
          data.error ||
          (typeof (data as { detail?: string }).detail === "string"
            ? (data as { detail?: string }).detail
            : undefined) ||
          "Resubmission failed",
      };
    }
    return data;
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Resubmission failed",
    };
  }
}

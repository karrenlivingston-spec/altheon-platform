const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type ResubmissionPackageParams = {
  clinicId: string;
  patientId: string;
  claimId: string;
  eobExtractionId: string;
  authHeaders: Record<string, string>;
};

export async function downloadResubmissionPackage(
  params: ResubmissionPackageParams,
): Promise<string> {
  const res = await fetch(`${API_BASE}/billing/resubmission-package`, {
    method: "POST",
    headers: {
      ...params.authHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clinic_id: params.clinicId,
      patient_id: params.patientId,
      claim_id: params.claimId,
      eob_extraction_id: params.eobExtractionId,
    }),
  });

  if (!res.ok) {
    const errJson = (await res.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(
      typeof errJson?.detail === "string"
        ? errJson.detail
        : "Could not generate resubmission package",
    );
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/i.exec(disposition);
  const filename = match?.[1] ?? "resubmission.pdf";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

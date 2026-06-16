"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, ShieldX, XCircle } from "lucide-react";
import Link from "next/link";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  InsuranceClaimDetail,
  InsuranceVerificationHistoryRow,
  InsuranceVerificationResult,
  formatUsdAmount,
} from "@/components/admin/billing/billingTypes";
import { WaitlistPatientOption } from "@/components/admin/appointments/waitlistTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function patientLabel(p: WaitlistPatientOption): string {
  const name = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  return name || p.id;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(
      value.includes("T") ? value : `${value}T12:00:00`,
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(value).slice(0, 10);
  }
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return formatUsdAmount(value);
}

function BenefitCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

export default function InsuranceVerificationPage() {
  const { clinicId } = useClinic();

  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<WaitlistPatientOption[]>(
    [],
  );
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] =
    useState<WaitlistPatientOption | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const [payerId, setPayerId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [dateOfService, setDateOfService] = useState("");

  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<InsuranceVerificationResult | null>(null);
  const [history, setHistory] = useState<InsuranceVerificationHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const searchPatients = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q || !clinicId) return [];
      const res = await fetch(
        `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}&search=${encodeURIComponent(q)}`,
        { headers: await authHeaders() },
      );
      const json = res.ok ? await res.json() : [];
      return Array.isArray(json) ? (json as WaitlistPatientOption[]) : [];
    },
    [clinicId],
  );

  const loadHistory = useCallback(async () => {
    if (!clinicId || !selectedPatient?.id) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/billing/insurance-verification-history?clinic_id=${encodeURIComponent(clinicId)}&patient_id=${encodeURIComponent(selectedPatient.id)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setHistory([]);
        return;
      }
      const data = (await res.json()) as InsuranceVerificationHistoryRow[];
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [clinicId, selectedPatient?.id]);

  const prefillFromPatient = useCallback(
    async (patient: WaitlistPatientOption) => {
      if (!clinicId) return;

      try {
        const h = await authHeaders();
        const patientRes = await fetch(
          `${API_BASE}/patients/${encodeURIComponent(patient.id)}?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        if (patientRes.ok) {
          const detail = (await patientRes.json()) as {
            date_of_birth?: string | null;
          };
          if (detail.date_of_birth) {
            setDateOfBirth(String(detail.date_of_birth).slice(0, 10));
          }
        }
      } catch {
        /* ignore */
      }

      try {
        const h = await authHeaders();
        const claimsRes = await fetch(
          `${API_BASE}/billing/claims?clinic_id=${encodeURIComponent(clinicId)}`,
          { headers: h },
        );
        if (!claimsRes.ok) return;
        const claims = (await claimsRes.json()) as InsuranceClaimDetail[];
        const patientClaims = (Array.isArray(claims) ? claims : [])
          .filter((c) => c.patient_id === patient.id)
          .sort((a, b) =>
            String(b.created_at ?? b.first_treatment_date ?? "").localeCompare(
              String(a.created_at ?? a.first_treatment_date ?? ""),
            ),
          );
        const latest = patientClaims[0];
        if (latest?.payer_id) setPayerId(latest.payer_id);
        if (latest?.member_id) setMemberId(latest.member_id);
      } catch {
        /* ignore */
      }
    },
    [clinicId],
  );

  useEffect(() => {
    if (!patientPickerOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPatientPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [patientPickerOpen]);

  useEffect(() => {
    if (!patientPickerOpen) return;
    const q = patientQuery.trim();
    if (!q) {
      setPatientResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      (async () => {
        setSearchLoading(true);
        try {
          const rows = await searchPatients(q);
          if (!cancelled) setPatientResults(rows);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [patientPickerOpen, patientQuery, searchPatients]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleVerify() {
    if (!clinicId || !selectedPatient?.id) {
      setError("Select a patient to verify eligibility.");
      return;
    }
    if (!payerId.trim() || !memberId.trim() || !dateOfBirth) {
      setError("Payer ID, member ID, and date of birth are required.");
      return;
    }

    setError(null);
    setVerifying(true);
    setResult(null);

    try {
      const body = {
        clinic_id: clinicId,
        patient_id: selectedPatient.id,
        payer_id: payerId.trim(),
        member_id: memberId.trim(),
        date_of_birth: dateOfBirth,
        first_name: selectedPatient.first_name ?? "",
        last_name: selectedPatient.last_name ?? "",
        ...(dateOfService ? { date_of_service: dateOfService } : {}),
      };

      const res = await fetch(`${API_BASE}/billing/insurance-verification`, {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          typeof err?.detail === "string"
            ? err.detail
            : "Eligibility verification failed",
        );
      }

      const data = (await res.json()) as InsuranceVerificationResult;
      setResult(data);
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eligibility verification failed");
    } finally {
      setVerifying(false);
    }
  }

  function handleSaveToRecord() {
    setToast({
      kind: "success",
      message: "Verification saved to patient record",
    });
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-6">
        <p className="mb-1 text-sm">
          <Link
            href="/admin/billing"
            className="font-medium text-teal-600 hover:text-teal-700"
          >
            ← Back to Billing
          </Link>
        </p>
        <h1 className={DS_PAGE_TITLE}>Insurance Verification</h1>
        <p className={DS_PAGE_SUBTITLE}>
          Real-time eligibility checks via Stedi (270/271)
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <div className={DS_CARD}>
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Verification Form
          </h2>

          <div className="space-y-4">
            <div ref={pickerRef} className="relative">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Patient
              </label>
              <input
                type="text"
                className={DS_INPUT}
                placeholder="Search by name…"
                value={
                  selectedPatient && !patientPickerOpen
                    ? patientLabel(selectedPatient)
                    : patientQuery
                }
                onChange={(e) => {
                  setPatientQuery(e.target.value);
                  setSelectedPatient(null);
                  setPatientPickerOpen(true);
                  setResult(null);
                }}
                onFocus={() => setPatientPickerOpen(true)}
              />
              {patientPickerOpen && (patientQuery.trim() || searchLoading) ? (
                <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {searchLoading ? (
                    <li className="px-3 py-2 text-sm text-gray-500">Searching…</li>
                  ) : patientResults.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-gray-500">
                      No patients found
                    </li>
                  ) : (
                    patientResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                          onClick={() => {
                            setSelectedPatient(p);
                            setPatientQuery(patientLabel(p));
                            setPatientPickerOpen(false);
                            setResult(null);
                            void prefillFromPatient(p);
                          }}
                        >
                          {patientLabel(p)}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Payer ID
              </label>
              <input
                type="text"
                className={DS_INPUT}
                placeholder="e.g. 87726"
                value={payerId}
                onChange={(e) => setPayerId(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Member ID
              </label>
              <input
                type="text"
                className={DS_INPUT}
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Date of Birth
              </label>
              <input
                type="date"
                className={DS_INPUT}
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Date of Service{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <input
                type="date"
                className={DS_INPUT}
                value={dateOfService}
                onChange={(e) => setDateOfService(e.target.value)}
              />
            </div>

            <button
              type="button"
              className={`${DS_PRIMARY_BTN} flex w-full items-center justify-center gap-2 disabled:opacity-60`}
              disabled={verifying}
              onClick={() => void handleVerify()}
            >
              {verifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Checking eligibility…
                </>
              ) : (
                "Verify Eligibility"
              )}
            </button>
          </div>
        </div>

        <div className={DS_CARD}>
          <h2 className="mb-4 text-base font-semibold text-gray-900">Results</h2>

          {verifying ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Loader2
                className="mb-3 h-10 w-10 animate-spin text-teal-600"
                aria-hidden
              />
              <p className="text-sm font-medium text-gray-700">
                Checking eligibility…
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Waiting for payer response
              </p>
            </div>
          ) : !result ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-gray-500">
              <ShieldCheck className="mb-3 h-10 w-10 text-gray-300" aria-hidden />
              Run a verification to see eligibility results
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                {result.eligible ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    Eligible
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-700">
                    <ShieldX className="h-4 w-4" aria-hidden />
                    Not Eligible
                  </span>
                )}
              </div>

              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-gray-500">Plan</dt>
                  <dd className="font-medium text-gray-900">
                    {result.plan_name || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Plan begin</dt>
                  <dd className="font-medium text-gray-900">
                    {result.plan_begin_date
                      ? formatDate(result.plan_begin_date)
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Subscriber</dt>
                  <dd className="font-medium text-gray-900">
                    {result.subscriber_name || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Member ID</dt>
                  <dd className="font-medium text-gray-900">
                    {result.member_id || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Group number</dt>
                  <dd className="font-medium text-gray-900">
                    {result.group_number || "—"}
                  </dd>
                </div>
              </dl>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <BenefitCard label="Copay" value={formatMoney(result.copay)} />
                <BenefitCard
                  label="Deductible"
                  value={formatMoney(result.deductible)}
                />
                <BenefitCard
                  label="Deductible Met"
                  value={formatMoney(result.deductible_met)}
                />
                <BenefitCard
                  label="Out of Pocket Max"
                  value={formatMoney(result.out_of_pocket_max)}
                />
                <BenefitCard
                  label="Out of Pocket Met"
                  value={formatMoney(result.out_of_pocket_met)}
                />
              </div>

              {result.coverage_details.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900">
                    Coverage details
                  </h3>
                  <div className={DS_TABLE_WRAP}>
                    <table className="min-w-full">
                      <thead className={DS_TABLE_HEAD}>
                        <tr>
                          <th className={DS_TH}>Benefit category</th>
                          <th className={DS_TH}>Coverage level</th>
                          <th className={DS_TH}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.coverage_details.map((row, idx) => (
                          <tr key={`${row.category}-${idx}`} className={DS_TR}>
                            <td className={DS_TD_PRIMARY}>{row.category}</td>
                            <td className={DS_TD_PRIMARY}>
                              {row.coverage_level || "—"}
                            </td>
                            <td className={DS_TD_PRIMARY}>
                              {row.amount !== "" && row.amount != null
                                ? typeof row.amount === "number"
                                  ? formatMoney(row.amount)
                                  : String(row.amount)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className={DS_SECONDARY_BTN}
                onClick={handleSaveToRecord}
              >
                Save to Patient Record
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={DS_CARD}>
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Verification History
          {selectedPatient ? (
            <span className="ml-2 text-sm font-normal text-gray-500">
              — {patientLabel(selectedPatient)}
            </span>
          ) : null}
        </h2>

        {!selectedPatient ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Select a patient to view past verifications
          </p>
        ) : historyLoading ? (
          <p className="py-6 text-center text-sm text-gray-500">Loading…</p>
        ) : history.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            No verifications yet for this patient
          </p>
        ) : (
          <div className={DS_TABLE_WRAP}>
            <table className="min-w-full">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Date Verified</th>
                  <th className={DS_TH}>Payer</th>
                  <th className={DS_TH}>Plan</th>
                  <th className={DS_TH}>Eligible</th>
                  <th className={DS_TH}>Copay</th>
                  <th className={DS_TH}>Deductible</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className={DS_TR}>
                    <td className={DS_TD_PRIMARY}>
                      {formatDate(row.verified_at)}
                    </td>
                    <td className={DS_TD_PRIMARY}>{row.payer_id || "—"}</td>
                    <td className={DS_TD_PRIMARY}>{row.plan_name || "—"}</td>
                    <td className={DS_TD_PRIMARY}>
                      {row.eligible ? (
                        <span className="text-green-700">Yes</span>
                      ) : (
                        <span className="text-red-600">No</span>
                      )}
                    </td>
                    <td className={DS_TD_PRIMARY}>{formatMoney(row.copay)}</td>
                    <td className={DS_TD_PRIMARY}>
                      {formatMoney(row.deductible)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast ? (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm shadow-lg ${
            toast.kind === "success"
              ? "bg-green-700 text-white"
              : "bg-red-700 text-white"
          }`}
          role="status"
        >
          {toast.kind === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

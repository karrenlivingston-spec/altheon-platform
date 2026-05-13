"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

const API_BASE = "https://altheon-platform.onrender.com";
const BRAND = "#16A34A";

type PrefillStatus = "loading" | "no_token" | "already_completed" | "expired" | "error" | "valid";

type PrefillResponse =
  | { status: "already_completed" }
  | { status: "expired" }
  | {
      status: "valid";
      patient: {
        first_name?: string | null;
        last_name?: string | null;
        phone?: string | null;
        preferred_language?: string | null;
      };
      appointment: {
        appointment_date?: string | null;
        start_time?: string | null;
        clinician_id?: string | null;
      };
    };

function formatAppointmentHeader(
  appointment_date: string | null | undefined,
  start_time: string | null | undefined,
): string | null {
  if (!start_time && !appointment_date) return null;
  try {
    const iso = start_time || `${appointment_date}T12:00:00`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const datePart = d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const timePart = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `Your appointment: ${datePart} at ${timePart}`;
  } catch {
    return null;
  }
}

const GENDER_OPTIONS = [
  { value: "", label: "Prefer not to say" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "other", label: "Other" },
] as const;

const STEP_LABELS = [
  "Your Information",
  "About Your Visit",
  "Medical History",
  "Consent",
];

const btnPrimary =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50";
const btnSecondary =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border-2 border-gray-300 bg-white px-5 py-3 text-base font-medium text-gray-800 transition hover:bg-gray-50";

function IntakeFormInner() {
  const searchParams = useSearchParams();
  const token = useMemo(() => (searchParams.get("token") || "").trim(), [searchParams]);

  const [prefillStatus, setPrefillStatus] = useState<PrefillStatus>("loading");
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Extract<PrefillResponse, { status: "valid" }> | null>(
    null,
  );

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  const [chiefComplaint, setChiefComplaint] = useState("");
  const [symptomDuration, setSymptomDuration] = useState("");
  const [mechanismOfInjury, setMechanismOfInjury] = useState("");
  const [painScale, setPainScale] = useState<number>(5);

  const [medications, setMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medicalConditions, setMedicalConditions] = useState("");
  const [previousTreatments, setPreviousTreatments] = useState("");

  const [consent, setConsent] = useState(false);

  const loadPrefill = useCallback(async () => {
    if (!token) {
      setPrefillStatus("no_token");
      return;
    }
    setPrefillStatus("loading");
    setPrefillError(null);
    try {
      const res = await fetch(
        `${API_BASE}/intake/form/${encodeURIComponent(token)}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (res.status === 404) {
        setPrefillStatus("error");
        setPrefillError(
          typeof data.detail === "string"
            ? data.detail
            : "This link is invalid. Please use the link from your text message.",
        );
        return;
      }

      if (res.status === 400 && data.status === "expired") {
        setPrefillStatus("expired");
        return;
      }

      if (!res.ok) {
        setPrefillStatus("error");
        setPrefillError(
          typeof data.detail === "string"
            ? data.detail
            : `Something went wrong (${res.status}). Please try again.`,
        );
        return;
      }

      if (data.status === "already_completed") {
        setPrefillStatus("already_completed");
        return;
      }

      if (data.status === "valid" && data.patient && data.appointment) {
        setPrefill(data as Extract<PrefillResponse, { status: "valid" }>);
        setPrefillStatus("valid");
        return;
      }

      setPrefillStatus("error");
      setPrefillError("Unexpected response from server.");
    } catch {
      setPrefillStatus("error");
      setPrefillError("Could not load the form. Check your connection and try again.");
    }
  }, [token]);

  useEffect(() => {
    void loadPrefill();
  }, [loadPrefill]);

  const appointmentLine = useMemo(() => {
    if (!prefill?.appointment) return null;
    return formatAppointmentHeader(
      prefill.appointment.appointment_date ?? undefined,
      prefill.appointment.start_time ?? undefined,
    );
  }, [prefill]);

  const canAdvanceFromStep2 = chiefComplaint.trim().length > 0;

  async function handleSubmit() {
    if (!token || !consent) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        token,
        chief_complaint: chiefComplaint.trim(),
        consent_to_treatment: true,
      };
      if (dateOfBirth.trim()) body.date_of_birth = dateOfBirth.trim();
      if (gender.trim()) body.gender = gender.trim();
      if (email.trim()) body.email = email.trim();
      if (address.trim()) body.address = address.trim();
      if (symptomDuration.trim()) body.symptom_duration = symptomDuration.trim();
      if (mechanismOfInjury.trim()) body.mechanism_of_injury = mechanismOfInjury.trim();
      if (medications.trim()) body.medications = medications.trim();
      if (allergies.trim()) body.allergies = allergies.trim();
      if (medicalConditions.trim()) body.medical_conditions = medicalConditions.trim();
      if (previousTreatments.trim()) body.previous_treatments = previousTreatments.trim();
      body.pain_scale = painScale;

      const res = await fetch(`${API_BASE}/intake/form/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (res.ok && data.status === "success") {
        setDone(true);
        return;
      }

      let msg =
        typeof data.detail === "string"
          ? data.detail
          : typeof data.message === "string"
            ? data.message
            : `Submit failed (${res.status})`;
      if (typeof data.detail === "object" && data.detail !== null) {
        const d = data.detail as Record<string, unknown>;
        if (typeof d.status === "string") msg = d.status;
      }
      if (data.status === "expired") msg = "This link has expired. Please contact the clinic.";
      if (data.status === "already_completed")
        msg = "This form was already submitted.";
      setSubmitError(msg);
    } catch {
      setSubmitError("Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (prefillStatus === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-16">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-transparent"
          style={{ borderTopColor: BRAND }}
          aria-hidden
        />
        <p className="mt-6 text-center text-gray-600">Loading your intake form…</p>
      </div>
    );
  }

  if (prefillStatus === "no_token") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
        <p className="max-w-md text-lg text-gray-800">
          Missing intake link. Open this page using the link sent to your phone (it includes a
          token).
        </p>
      </div>
    );
  }

  if (prefillStatus === "already_completed") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
        <p className="max-w-md text-lg leading-relaxed text-gray-800">
          Your intake form has already been submitted. See you at your appointment!
        </p>
      </div>
    );
  }

  if (prefillStatus === "expired") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
        <p className="max-w-md text-lg leading-relaxed text-gray-800">
          This intake link has expired. Please contact the clinic.
        </p>
      </div>
    );
  }

  if (prefillStatus === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
        <p className="max-w-md text-lg text-red-700">{prefillError || "Something went wrong."}</p>
        <button
          type="button"
          onClick={() => void loadPrefill()}
          className={`${btnPrimary} mt-8`}
          style={{ backgroundColor: BRAND }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-16 text-center">
        <p className="max-w-md text-lg leading-relaxed text-gray-800">
          ✅ Thank you! Your intake form has been submitted. We look forward to seeing you at your
          appointment.
        </p>
      </div>
    );
  }

  if (!prefill || prefillStatus !== "valid") {
    return null;
  }

  const p = prefill.patient;

  return (
    <div className="min-h-screen bg-slate-50 pb-12 pt-8 sm:pt-12">
      <div className="mx-auto max-w-lg px-4 sm:px-6">
        <h1 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Patient intake
        </h1>
        {appointmentLine ? (
          <p className="mt-3 text-center text-base font-medium text-gray-700">{appointmentLine}</p>
        ) : null}

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-8">
            <div className="flex justify-between gap-1 sm:gap-2">
              {STEP_LABELS.map((label, i) => (
                <div key={label} className="flex-1 text-center">
                  <div
                    className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold sm:h-11 sm:w-11 ${
                      i <= step ? "text-white" : "bg-gray-100 text-gray-400"
                    }`}
                    style={i <= step ? { backgroundColor: BRAND } : undefined}
                    aria-current={i === step ? "step" : undefined}
                  >
                    {i + 1}
                  </div>
                  <p
                    className={`mt-1 hidden text-[10px] font-medium uppercase tracking-wide sm:block ${
                      i === step ? "text-gray-900" : "text-gray-400"
                    }`}
                  >
                    {label}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${((step + 1) / STEP_LABELS.length) * 100}%`,
                  backgroundColor: BRAND,
                }}
              />
            </div>
            <p className="mt-3 text-center text-sm font-semibold text-gray-800 sm:hidden">
              {STEP_LABELS[step]}
            </p>
          </div>

          {step === 0 ? (
            <div className="space-y-5">
              <Field label="First name">
                <input
                  readOnly
                  className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-800"
                  value={p.first_name ?? ""}
                />
              </Field>
              <Field label="Last name">
                <input
                  readOnly
                  className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-800"
                  value={p.last_name ?? ""}
                />
              </Field>
              <Field label="Phone">
                <input
                  readOnly
                  className="w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-800"
                  value={p.phone ?? ""}
                />
              </Field>
              <Field label="Date of birth">
                <input
                  type="date"
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </Field>
              <Field label="Gender">
                <select
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                >
                  {GENDER_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Address">
                <input
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address, city, state, zip"
                />
              </Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-5">
              <Field label="Chief complaint" required>
                <textarea
                  required
                  rows={4}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={chiefComplaint}
                  onChange={(e) => setChiefComplaint(e.target.value)}
                  placeholder="Describe your main reason for visiting"
                />
              </Field>
              <Field label="How long have you had this issue?">
                <input
                  className="min-h-[44px] w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={symptomDuration}
                  onChange={(e) => setSymptomDuration(e.target.value)}
                  placeholder="e.g. 2 weeks, 3 months"
                />
              </Field>
              <Field label="How did it happen?">
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={mechanismOfInjury}
                  onChange={(e) => setMechanismOfInjury(e.target.value)}
                  placeholder="e.g. sports injury, car accident, gradual onset"
                />
              </Field>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Pain scale (1 = No pain, 10 = Worst pain)
                </label>
                <div className="flex items-center gap-4 pt-1">
                  <span className="text-sm text-gray-500">1</span>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={painScale}
                    onChange={(e) => setPainScale(Number(e.target.value))}
                    className="h-11 flex-1 cursor-pointer accent-[#16A34A]"
                    style={{ accentColor: BRAND }}
                  />
                  <span className="text-sm text-gray-500">10</span>
                </div>
                <p className="mt-2 text-center text-lg font-semibold text-gray-900">{painScale}</p>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5">
              <Field label="Current medications">
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={medications}
                  onChange={(e) => setMedications(e.target.value)}
                  placeholder="List any medications"
                />
              </Field>
              <Field label="Allergies">
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={allergies}
                  onChange={(e) => setAllergies(e.target.value)}
                  placeholder="List any allergies or None"
                />
              </Field>
              <Field label="Medical conditions">
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={medicalConditions}
                  onChange={(e) => setMedicalConditions(e.target.value)}
                  placeholder="e.g. diabetes, hypertension or None"
                />
              </Field>
              <Field label="Previous treatments for this issue">
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-base text-gray-900 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/25"
                  value={previousTreatments}
                  onChange={(e) => setPreviousTreatments(e.target.value)}
                  placeholder="e.g. physical therapy, chiropractic, surgery"
                />
              </Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <p className="text-base leading-relaxed text-gray-800">
                By submitting this form, I consent to evaluation and treatment at this clinic. I
                confirm the information provided is accurate to the best of my knowledge.
              </p>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-[#16A34A] focus:ring-[#16A34A]"
                  style={{ accentColor: BRAND }}
                />
                <span className="text-base font-medium text-gray-900">I agree to the above</span>
              </label>
              {submitError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {submitError}
                </p>
              ) : null}
              <button
                type="button"
                disabled={!consent || submitting}
                onClick={() => void handleSubmit()}
                className={`${btnPrimary} w-full text-lg`}
                style={{ backgroundColor: BRAND }}
              >
                {submitting ? "Submitting…" : "Submit intake form"}
              </button>
            </div>
          ) : null}

          {step < 3 ? (
            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                className={btnSecondary}
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Back
              </button>
              <button
                type="button"
                className={btnPrimary}
                style={{ backgroundColor: BRAND }}
                disabled={step === 1 && !canAdvanceFromStep2}
                onClick={() => {
                  if (step === 1 && !canAdvanceFromStep2) return;
                  setStep((s) => Math.min(STEP_LABELS.length - 1, s + 1));
                }}
              >
                Next
              </button>
            </div>
          ) : (
            <div className="mt-8">
              <button
                type="button"
                className={btnSecondary}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function FormFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-gray-200 border-t-transparent"
        style={{ borderTopColor: BRAND }}
      />
    </div>
  );
}

export default function IntakeFormPage() {
  return (
    <Suspense fallback={<FormFallback />}>
      <IntakeFormInner />
    </Suspense>
  );
}

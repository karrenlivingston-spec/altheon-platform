"use client";

import { useCallback, useMemo, useState } from "react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { FeeScheduleManager } from "@/components/admin/FeeScheduleManager";
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";

const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "America/Phoenix", label: "Arizona (America/Phoenix)" },
  { value: "America/Anchorage", label: "Alaska (America/Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Pacific/Honolulu)" },
] as const;

const STEPS = [
  { id: 1, label: "Clinic Basics" },
  { id: 2, label: "Location" },
  { id: 3, label: "Clinicians" },
  { id: 4, label: "Treatment Types" },
  { id: 5, label: "Routing Rules" },
  { id: 6, label: "Admin User" },
  { id: 7, label: "Review" },
] as const;

const LABEL_CLASS = "block text-sm font-medium text-gray-700";

type ClinicianForm = {
  id: string;
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  phone: string;
  bio: string;
};

type TreatmentTypeForm = {
  id: string;
  name: string;
  description: string;
  duration_minutes: string;
  requires_evaluation: boolean;
};

type RoutingRuleForm = {
  id: string;
  treatment_type_name: string;
  clinician_email: string;
  keywords: string;
  priority_order: string;
};

type SuccessPayload = {
  clinic_id: string;
  location_id: string;
  clinician_ids: string[];
  treatment_type_ids: string[];
  admin_user_id: string;
  slug: string;
};

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyClinician(): ClinicianForm {
  return {
    id: newId(),
    first_name: "",
    last_name: "",
    title: "",
    email: "",
    phone: "",
    bio: "",
  };
}

function emptyTreatmentType(): TreatmentTypeForm {
  return {
    id: newId(),
    name: "",
    description: "",
    duration_minutes: "60",
    requires_evaluation: false,
  };
}

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function parseKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function BrandMark() {
  const [asset, setAsset] = useState<"svg" | "text">("svg");
  if (asset === "text") {
    return (
      <p
        className="text-center text-3xl font-bold tracking-tight text-gray-900"
        style={{ letterSpacing: "-0.5px" }}
      >
        Altheon
      </p>
    );
  }
  return (
    <img
      src="/altheon-logo.svg"
      alt="Altheon"
      width={200}
      height={64}
      className="mx-auto h-14 w-auto object-contain"
      onError={() => setAsset("text")}
    />
  );
}

export default function SuperadminOnboardPage() {
  const [phase, setPhase] = useState<"gate" | "wizard" | "success" | "fee_schedule">(
    "gate",
  );
  const [feeToken, setFeeToken] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);

  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);

  const [clinicName, setClinicName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [clinicPhone, setClinicPhone] = useState("");
  const [clinicEmail, setClinicEmail] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [brandColor, setBrandColor] = useState("#16A34A");

  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [locationPhone, setLocationPhone] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");

  const [clinicians, setClinicians] = useState<ClinicianForm[]>(() => [
    emptyClinician(),
  ]);
  const [treatmentTypes, setTreatmentTypes] = useState<TreatmentTypeForm[]>(() => [
    emptyTreatmentType(),
  ]);
  const [routingRules, setRoutingRules] = useState<RoutingRuleForm[]>([]);

  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [successData, setSuccessData] = useState<SuccessPayload | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  function handleClinicNameChange(value: string) {
    setClinicName(value);
    if (!slugTouched) {
      setSlug(slugFromName(value));
    }
  }

  function resetAll() {
    setPhase("gate");
    setPassphrase("");
    setPassphraseInput("");
    setPassphraseError(null);
    setStep(1);
    setStepError(null);
    setApiError(null);
    setSubmitBusy(false);
    setClinicName("");
    setSlug("");
    setSlugTouched(false);
    setClinicPhone("");
    setClinicEmail("");
    setClinicAddress("");
    setLogoUrl("");
    setBrandColor("#16A34A");
    setLocationName("");
    setLocationAddress("");
    setLocationPhone("");
    setTimezone("America/New_York");
    setClinicians([emptyClinician()]);
    setTreatmentTypes([emptyTreatmentType()]);
    setRoutingRules([]);
    setAdminEmail("");
    setAdminPassword("");
    setConfirmPassword("");
    setSuccessData(null);
    setFeeToken("");
    setCopyOk(false);
  }

  function enterWizard() {
    if (!passphraseInput.trim()) {
      setPassphraseError("Enter the superadmin passphrase.");
      return;
    }
    setPassphrase(passphraseInput.trim());
    setPassphraseError(null);
    setPhase("wizard");
    setStep(1);
  }

  const validateStep = useCallback(
    (s: number): string | null => {
      if (s === 1) {
        if (!clinicName.trim()) return "Clinic name is required.";
        if (!slug.trim()) return "Slug is required.";
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) {
          return "Slug must be lowercase letters, numbers, and hyphens only.";
        }
        if (!clinicPhone.trim()) return "Phone is required.";
        if (!clinicEmail.trim()) return "Email is required.";
        if (!isValidEmail(clinicEmail)) return "Enter a valid clinic email.";
        if (!clinicAddress.trim()) return "Address is required.";
        return null;
      }
      if (s === 2) {
        if (!locationName.trim()) return "Location name is required.";
        if (!locationAddress.trim()) return "Location address is required.";
        if (!locationPhone.trim()) return "Location phone is required.";
        if (!timezone) return "Timezone is required.";
        return null;
      }
      if (s === 3) {
        for (let i = 0; i < clinicians.length; i++) {
          const c = clinicians[i];
          const label = `Clinician ${i + 1}`;
          if (!c.first_name.trim()) return `${label}: first name is required.`;
          if (!c.last_name.trim()) return `${label}: last name is required.`;
          if (!c.title.trim()) return `${label}: title is required.`;
          if (!c.email.trim()) return `${label}: email is required.`;
          if (!isValidEmail(c.email)) return `${label}: enter a valid email.`;
        }
        const emails = clinicians.map((c) => c.email.trim().toLowerCase());
        if (new Set(emails).size !== emails.length) {
          return "Clinician emails must be unique.";
        }
        return null;
      }
      if (s === 4) {
        for (let i = 0; i < treatmentTypes.length; i++) {
          const t = treatmentTypes[i];
          const label = `Treatment type ${i + 1}`;
          if (!t.name.trim()) return `${label}: name is required.`;
          const dur = parseInt(t.duration_minutes, 10);
          if (Number.isNaN(dur) || dur <= 0) {
            return `${label}: duration must be a positive number.`;
          }
        }
        const names = treatmentTypes.map((t) => t.name.trim());
        if (new Set(names).size !== names.length) {
          return "Treatment type names must be unique.";
        }
        return null;
      }
      if (s === 5) {
        for (let i = 0; i < routingRules.length; i++) {
          const r = routingRules[i];
          const label = `Rule ${i + 1}`;
          if (!r.treatment_type_name.trim()) {
            return `${label}: select a treatment type.`;
          }
          if (!r.clinician_email.trim()) {
            return `${label}: select a clinician.`;
          }
          const po = parseInt(r.priority_order, 10);
          if (Number.isNaN(po)) {
            return `${label}: priority order must be a number.`;
          }
        }
        return null;
      }
      if (s === 6) {
        if (!adminEmail.trim()) return "Admin email is required.";
        if (!isValidEmail(adminEmail)) return "Enter a valid admin email.";
        if (!adminPassword) return "Password is required.";
        if (adminPassword.length < 8) {
          return "Password must be at least 8 characters.";
        }
        if (adminPassword !== confirmPassword) {
          return "Passwords do not match.";
        }
        return null;
      }
      return null;
    },
    [
      clinicName,
      slug,
      clinicPhone,
      clinicEmail,
      clinicAddress,
      locationName,
      locationAddress,
      locationPhone,
      timezone,
      clinicians,
      treatmentTypes,
      routingRules,
      adminEmail,
      adminPassword,
      confirmPassword,
    ],
  );

  function goNext() {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(7, s + 1));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  function skipRouting() {
    setRoutingRules([]);
    setStepError(null);
    setStep(6);
  }

  const treatmentNameOptions = useMemo(
    () => treatmentTypes.map((t) => t.name.trim()).filter(Boolean),
    [treatmentTypes],
  );

  const clinicianOptions = useMemo(
    () =>
      clinicians
        .filter((c) => c.email.trim() && c.first_name.trim())
        .map((c) => ({
          email: c.email.trim().toLowerCase(),
          label: `${c.first_name.trim()} ${c.last_name.trim()}`.trim(),
        })),
    [clinicians],
  );

  async function submitOnboard() {
    setApiError(null);
    for (let s = 1; s <= 6; s++) {
      const err = validateStep(s);
      if (err) {
        setStepError(err);
        setStep(s);
        return;
      }
    }

    setSubmitBusy(true);
    try {
      const body: Record<string, unknown> = {
        clinic: {
          name: clinicName.trim(),
          slug: slug.trim().toLowerCase(),
          phone: clinicPhone.trim(),
          email: clinicEmail.trim().toLowerCase(),
          address: clinicAddress.trim(),
          ...(logoUrl.trim() ? { logo_url: logoUrl.trim() } : {}),
          ...(brandColor.trim() ? { brand_color: brandColor.trim() } : {}),
        },
        location: {
          name: locationName.trim(),
          address: locationAddress.trim(),
          phone: locationPhone.trim(),
          timezone,
        },
        clinicians: clinicians.map((c) => ({
          first_name: c.first_name.trim(),
          last_name: c.last_name.trim(),
          title: c.title.trim(),
          email: c.email.trim().toLowerCase(),
          ...(c.phone.trim() ? { phone: c.phone.trim() } : {}),
          ...(c.bio.trim() ? { bio: c.bio.trim() } : {}),
        })),
        treatment_types: treatmentTypes.map((t) => ({
          name: t.name.trim(),
          ...(t.description.trim() ? { description: t.description.trim() } : {}),
          duration_minutes: parseInt(t.duration_minutes, 10),
          requires_evaluation: t.requires_evaluation,
        })),
        routing_rules: routingRules.map((r) => ({
          treatment_type_name: r.treatment_type_name.trim(),
          clinician_email: r.clinician_email.trim().toLowerCase(),
          condition_keywords: parseKeywords(r.keywords),
          priority_order: parseInt(r.priority_order, 10) || 0,
        })),
        admin_email: adminEmail.trim().toLowerCase(),
        admin_password: adminPassword,
      };

      const res = await fetch(`${API_BASE}/superadmin/onboard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Superadmin-Secret": passphrase,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 403) {
        setPassphraseError("Invalid passphrase");
        setPhase("gate");
        setPassphraseInput("");
        setPassphrase("");
        return;
      }

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setApiError(t.trim() || `Request failed (${res.status})`);
        return;
      }

      const data = (await res.json()) as SuccessPayload;
      setSuccessData(data);
      const { data: signInData, error: signInErr } =
        await supabase.auth.signInWithPassword({
          email: adminEmail.trim().toLowerCase(),
          password: adminPassword,
        });
      setFeeToken(
        !signInErr && signInData.session?.access_token
          ? signInData.session.access_token
          : "",
      );
      setPhase("fee_schedule");
    } catch {
      setApiError("Network error. Please try again.");
    } finally {
      setSubmitBusy(false);
    }
  }

  async function copyClinicId() {
    if (!successData?.clinic_id) return;
    try {
      await navigator.clipboard.writeText(successData.clinic_id);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      /* ignore */
    }
  }

  if (phase === "gate") {
    return (
      <div className="min-h-screen bg-[#f0f4f8] px-4 py-10">
        <div className="mx-auto w-full max-w-md">
          <div className={`${DS_CARD} p-8`}>
            <BrandMark />
            <h1 className={`${DS_PAGE_TITLE} mt-6 text-center text-xl`}>
              Clinic onboarding
            </h1>
            <p className="mt-1 text-center text-sm text-gray-500">
              Internal KJL use only
            </p>
            {passphraseError ? (
              <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-center text-sm text-red-800">
                {passphraseError}
              </p>
            ) : null}
            <label className={`${LABEL_CLASS} mt-6`}>
              Enter superadmin passphrase
              <input
                type="password"
                value={passphraseInput}
                onChange={(e) => setPassphraseInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") enterWizard();
                }}
                className={`mt-1 ${DS_INPUT}`}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              onClick={enterWizard}
              className={`${DS_PRIMARY_BTN} mt-6 w-full`}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "fee_schedule" && successData) {
    return (
      <div className="min-h-screen bg-[#f0f4f8] px-4 py-10">
        <div className="mx-auto w-full max-w-3xl">
          <div className={`${DS_CARD} p-8`}>
            <BrandMark />
            <h1 className={`${DS_PAGE_TITLE} mt-6 text-xl text-green-800`}>
              Clinic created successfully
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {clinicName} ·{" "}
              <span className="font-mono text-gray-800">{successData.slug}</span>
            </p>
            <h2 className="mt-8 text-lg font-semibold text-gray-900">
              Fee Schedule (Optional)
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              You can upload this clinic&apos;s fee schedule now or skip — it can
              be configured later in Settings.
            </p>
            {!feeToken ? (
              <p className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Sign in as the clinic admin ({adminEmail}) in Settings to
                manage the fee schedule, or skip for now.
              </p>
            ) : (
              <div className="mt-6">
                <FeeScheduleManager
                  clinicId={successData.clinic_id}
                  token={feeToken}
                />
              </div>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void supabase.auth.signOut();
                  resetAll();
                }}
                className={`${DS_PRIMARY_BTN} flex-1`}
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={() => void copyClinicId()}
                className={`${DS_SECONDARY_BTN} px-4`}
              >
                {copyOk ? "Copied ID" : "Copy clinic ID"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f4f8] px-4 py-8 pb-16">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 text-center">
          <BrandMark />
          <p className="mt-2 text-xs font-medium uppercase tracking-wider text-gray-500">
            KJL clinic onboarding
          </p>
        </div>

        <nav aria-label="Onboarding progress" className="mb-8">
          <ol className="flex flex-wrap justify-center gap-1 sm:gap-2">
            {STEPS.map((s) => {
              const active = s.id === step;
              const done = s.id < step;
              return (
                <li
                  key={s.id}
                  className={[
                    "flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium sm:px-3 sm:text-xs",
                    active
                      ? "bg-[#16A34A] text-white"
                      : done
                        ? "bg-green-50 text-green-800"
                        : "bg-white text-gray-500",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                      active ? "bg-white/20" : "bg-gray-100",
                    ].join(" ")}
                  >
                    {s.id}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className={`${DS_CARD}`}>
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {STEPS[step - 1]?.label}
            </h2>
          </div>

          <div className="space-y-4 px-6 py-6">
            {stepError ? (
              <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800">
                {stepError}
              </p>
            ) : null}

            {step === 1 ? (
              <>
                <label className={LABEL_CLASS}>
                  Clinic Name
                  <input
                    type="text"
                    value={clinicName}
                    onChange={(e) => handleClinicNameChange(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Slug
                  <input
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value);
                    }}
                    className={`mt-1 ${DS_INPUT} font-mono text-sm`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Phone
                  <input
                    type="tel"
                    value={clinicPhone}
                    onChange={(e) => setClinicPhone(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Email
                  <input
                    type="email"
                    value={clinicEmail}
                    onChange={(e) => setClinicEmail(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Address
                  <input
                    type="text"
                    value={clinicAddress}
                    onChange={(e) => setClinicAddress(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Logo URL{" "}
                  <span className="font-normal text-gray-400">(optional)</span>
                  <input
                    type="url"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                    placeholder="https://…"
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Brand Color{" "}
                  <span className="font-normal text-gray-400">(optional)</span>
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="color"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className="h-10 w-14 cursor-pointer rounded border border-gray-200"
                    />
                    <input
                      type="text"
                      value={brandColor}
                      onChange={(e) => setBrandColor(e.target.value)}
                      className={`${DS_INPUT} flex-1 font-mono text-sm`}
                    />
                  </div>
                </label>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <label className={LABEL_CLASS}>
                  Location Name
                  <input
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Address
                  <input
                    type="text"
                    value={locationAddress}
                    onChange={(e) => setLocationAddress(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Phone
                  <input
                    type="tel"
                    value={locationPhone}
                    onChange={(e) => setLocationPhone(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Timezone
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                  >
                    {US_TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}

            {step === 3 ? (
              <div className="space-y-6">
                {clinicians.map((c, idx) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-gray-100 bg-gray-50/80 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        Clinician {idx + 1}
                      </span>
                      {clinicians.length > 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setClinicians((prev) =>
                              prev.filter((x) => x.id !== c.id),
                            )
                          }
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className={LABEL_CLASS}>
                        First Name
                        <input
                          type="text"
                          value={c.first_name}
                          onChange={(e) =>
                            setClinicians((prev) =>
                              prev.map((x) =>
                                x.id === c.id
                                  ? { ...x, first_name: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                      <label className={LABEL_CLASS}>
                        Last Name
                        <input
                          type="text"
                          value={c.last_name}
                          onChange={(e) =>
                            setClinicians((prev) =>
                              prev.map((x) =>
                                x.id === c.id
                                  ? { ...x, last_name: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                    </div>
                    <label className={`${LABEL_CLASS} mt-3`}>
                      Title
                      <input
                        type="text"
                        value={c.title}
                        onChange={(e) =>
                          setClinicians((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, title: e.target.value } : x,
                            ),
                          )
                        }
                        className={`mt-1 ${DS_INPUT}`}
                        placeholder="DPT, DC, …"
                      />
                    </label>
                    <label className={`${LABEL_CLASS} mt-3`}>
                      Email
                      <input
                        type="email"
                        value={c.email}
                        onChange={(e) =>
                          setClinicians((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, email: e.target.value } : x,
                            ),
                          )
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className={`${LABEL_CLASS} mt-3`}>
                      Phone{" "}
                      <span className="font-normal text-gray-400">
                        (optional)
                      </span>
                      <input
                        type="tel"
                        value={c.phone}
                        onChange={(e) =>
                          setClinicians((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, phone: e.target.value } : x,
                            ),
                          )
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className={`${LABEL_CLASS} mt-3`}>
                      Bio{" "}
                      <span className="font-normal text-gray-400">
                        (optional)
                      </span>
                      <textarea
                        value={c.bio}
                        onChange={(e) =>
                          setClinicians((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, bio: e.target.value } : x,
                            ),
                          )
                        }
                        rows={2}
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setClinicians((prev) => [...prev, emptyClinician()])
                  }
                  className={DS_SECONDARY_BTN}
                >
                  + Add Clinician
                </button>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-6">
                {treatmentTypes.map((t, idx) => (
                  <div
                    key={t.id}
                    className="rounded-lg border border-gray-100 bg-gray-50/80 p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        Treatment type {idx + 1}
                      </span>
                      {treatmentTypes.length > 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setTreatmentTypes((prev) =>
                              prev.filter((x) => x.id !== t.id),
                            )
                          }
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <label className={LABEL_CLASS}>
                      Name
                      <input
                        type="text"
                        value={t.name}
                        onChange={(e) =>
                          setTreatmentTypes((prev) =>
                            prev.map((x) =>
                              x.id === t.id ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className={`${LABEL_CLASS} mt-3`}>
                      Description{" "}
                      <span className="font-normal text-gray-400">
                        (optional)
                      </span>
                      <textarea
                        value={t.description}
                        onChange={(e) =>
                          setTreatmentTypes((prev) =>
                            prev.map((x) =>
                              x.id === t.id
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          )
                        }
                        rows={2}
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className={`${LABEL_CLASS} mt-3`}>
                      Duration (minutes)
                      <input
                        type="number"
                        min={1}
                        value={t.duration_minutes}
                        onChange={(e) =>
                          setTreatmentTypes((prev) =>
                            prev.map((x) =>
                              x.id === t.id
                                ? { ...x, duration_minutes: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className={`mt-1 ${DS_INPUT}`}
                      />
                    </label>
                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={t.requires_evaluation}
                        onChange={(e) =>
                          setTreatmentTypes((prev) =>
                            prev.map((x) =>
                              x.id === t.id
                                ? {
                                    ...x,
                                    requires_evaluation: e.target.checked,
                                  }
                                : x,
                            ),
                          )
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Requires evaluation
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setTreatmentTypes((prev) => [...prev, emptyTreatmentType()])
                  }
                  className={DS_SECONDARY_BTN}
                >
                  + Add Treatment Type
                </button>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">
                  Optional — map treatment types to clinicians with keyword
                  conditions.
                </p>
                {routingRules.length === 0 ? (
                  <p className="text-sm text-gray-400">No routing rules yet.</p>
                ) : (
                  routingRules.map((r, idx) => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-gray-100 bg-gray-50/80 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          Rule {idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setRoutingRules((prev) =>
                              prev.filter((x) => x.id !== r.id),
                            )
                          }
                          className="text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <label className={LABEL_CLASS}>
                        Treatment Type
                        <select
                          value={r.treatment_type_name}
                          onChange={(e) =>
                            setRoutingRules((prev) =>
                              prev.map((x) =>
                                x.id === r.id
                                  ? {
                                      ...x,
                                      treatment_type_name: e.target.value,
                                    }
                                  : x,
                              ),
                            )
                          }
                          className={`mt-1 ${DS_INPUT}`}
                        >
                          <option value="">Select…</option>
                          {treatmentNameOptions.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={`${LABEL_CLASS} mt-3`}>
                        Clinician
                        <select
                          value={r.clinician_email}
                          onChange={(e) =>
                            setRoutingRules((prev) =>
                              prev.map((x) =>
                                x.id === r.id
                                  ? { ...x, clinician_email: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className={`mt-1 ${DS_INPUT}`}
                        >
                          <option value="">Select…</option>
                          {clinicianOptions.map((c) => (
                            <option key={c.email} value={c.email}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={`${LABEL_CLASS} mt-3`}>
                        Condition Keywords
                        <input
                          type="text"
                          value={r.keywords}
                          onChange={(e) =>
                            setRoutingRules((prev) =>
                              prev.map((x) =>
                                x.id === r.id
                                  ? { ...x, keywords: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className={`mt-1 ${DS_INPUT}`}
                          placeholder="knee, shoulder, …"
                        />
                      </label>
                      <label className={`${LABEL_CLASS} mt-3`}>
                        Priority Order
                        <input
                          type="number"
                          value={r.priority_order}
                          onChange={(e) =>
                            setRoutingRules((prev) =>
                              prev.map((x) =>
                                x.id === r.id
                                  ? { ...x, priority_order: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className={`mt-1 ${DS_INPUT}`}
                        />
                      </label>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={() =>
                    setRoutingRules((prev) => [
                      ...prev,
                      {
                        id: newId(),
                        treatment_type_name: treatmentNameOptions[0] ?? "",
                        clinician_email: clinicianOptions[0]?.email ?? "",
                        keywords: "",
                        priority_order: "0",
                      },
                    ])
                  }
                  className={DS_SECONDARY_BTN}
                >
                  + Add Rule
                </button>
                <button
                  type="button"
                  onClick={skipRouting}
                  className="ml-2 text-sm text-gray-500 underline hover:text-gray-700"
                >
                  Skip this step
                </button>
              </div>
            ) : null}

            {step === 6 ? (
              <>
                <label className={LABEL_CLASS}>
                  Admin Email
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                    autoComplete="off"
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Password
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                    autoComplete="new-password"
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Confirm Password
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`mt-1 ${DS_INPUT}`}
                    autoComplete="new-password"
                  />
                </label>
              </>
            ) : null}

            {step === 7 ? (
              <div className="space-y-5 text-sm text-gray-800">
                <section>
                  <h3 className="font-semibold text-gray-900">Clinic</h3>
                  <ul className="mt-1 list-inside list-disc text-gray-600">
                    <li>{clinicName}</li>
                    <li>Slug: {slug}</li>
                    <li>{clinicPhone}</li>
                    <li>{clinicEmail}</li>
                    <li>{clinicAddress}</li>
                    {logoUrl.trim() ? <li>Logo: {logoUrl}</li> : null}
                    {brandColor ? <li>Brand color: {brandColor}</li> : null}
                  </ul>
                </section>
                <section>
                  <h3 className="font-semibold text-gray-900">Location</h3>
                  <ul className="mt-1 list-inside list-disc text-gray-600">
                    <li>{locationName}</li>
                    <li>{locationAddress}</li>
                    <li>{locationPhone}</li>
                    <li>{timezone}</li>
                  </ul>
                </section>
                <section>
                  <h3 className="font-semibold text-gray-900">
                    Clinicians ({clinicians.length})
                  </h3>
                  <ul className="mt-1 space-y-2 text-gray-600">
                    {clinicians.map((c) => (
                      <li key={c.id}>
                        {c.first_name} {c.last_name}, {c.title} — {c.email}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="font-semibold text-gray-900">
                    Treatment Types ({treatmentTypes.length})
                  </h3>
                  <ul className="mt-1 space-y-2 text-gray-600">
                    {treatmentTypes.map((t) => (
                      <li key={t.id}>
                        {t.name} — {t.duration_minutes} min
                        {t.requires_evaluation ? " (eval required)" : ""}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="font-semibold text-gray-900">
                    Routing Rules ({routingRules.length})
                  </h3>
                  {routingRules.length === 0 ? (
                    <p className="mt-1 text-gray-500">None</p>
                  ) : (
                    <ul className="mt-1 space-y-2 text-gray-600">
                      {routingRules.map((r) => (
                        <li key={r.id}>
                          {r.treatment_type_name} →{" "}
                          {clinicianOptions.find(
                            (c) => c.email === r.clinician_email,
                          )?.label ?? r.clinician_email}{" "}
                          (priority {r.priority_order})
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="font-semibold text-gray-900">Admin User</h3>
                  <ul className="mt-1 list-inside list-disc text-gray-600">
                    <li>{adminEmail}</li>
                    <li>Password: ••••••••</li>
                  </ul>
                </section>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1 || submitBusy}
              className={`${DS_SECONDARY_BTN} disabled:opacity-40`}
            >
              Back
            </button>
            {step < 7 ? (
              <button
                type="button"
                onClick={goNext}
                className={DS_PRIMARY_BTN}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submitOnboard()}
                disabled={submitBusy}
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
              >
                {submitBusy ? "Creating…" : "Create Clinic"}
              </button>
            )}
          </div>
        </div>

        {apiError ? (
          <div
            className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            <span>{apiError}</span>
            <button
              type="button"
              onClick={() => setApiError(null)}
              className="shrink-0 text-red-600 hover:text-red-900"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

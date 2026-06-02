"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formTypeTitle,
  getFormConfig,
  type OutcomeFormType,
} from "@/lib/outcomeMeasureForms";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const BRAND = "#16A34A";
const PAGE_BG = "linear-gradient(160deg, #0f2f2a 0%, #0b1f2d 100%)";

type LoadStatus = "loading" | "valid" | "already_completed" | "not_found" | "error";

export default function OutcomeMeasurePage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token.trim() : "";

  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formType, setFormType] = useState<OutcomeFormType | null>(null);
  const [patientFirstName, setPatientFirstName] = useState("");
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const formConfig = useMemo(
    () => (formType ? getFormConfig(formType) : null),
    [formType],
  );

  useEffect(() => {
    if (!token) {
      setLoadStatus("not_found");
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoadStatus("loading");
      setLoadError(null);
      try {
        const res = await fetch(
          `${API_BASE}/outcome-measures/${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        if (res.status === 404) {
          setLoadStatus("not_found");
          return;
        }
        if (!res.ok) {
          setLoadStatus("error");
          setLoadError(await res.text().catch(() => "Could not load form"));
          return;
        }
        const json = (await res.json()) as {
          status?: string;
          form_type?: string;
          patient_first_name?: string | null;
        };
        if (json.status === "already_completed") {
          setLoadStatus("already_completed");
          return;
        }
        const ft = (json.form_type ?? "").trim().toLowerCase();
        if (ft !== "ndi" && ft !== "odi" && ft !== "quickdash") {
          setLoadStatus("error");
          setLoadError("Unknown form type");
          return;
        }
        setFormType(ft);
        setPatientFirstName((json.patient_first_name ?? "").trim());
        setAnswers(new Array(getFormConfig(ft).questions.length).fill(null));
        setLoadStatus("valid");
      } catch {
        if (!cancelled) {
          setLoadStatus("error");
          setLoadError("Could not load form");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const allAnswered = useMemo(
    () => answers.length > 0 && answers.every((a) => a !== null),
    [answers],
  );

  const setAnswer = useCallback((index: number, value: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !allAnswered) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(
        `${API_BASE}/outcome-measures/${encodeURIComponent(token)}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: answers.map((a) => Number(a)),
          }),
        },
      );
      if (!res.ok) {
        setSubmitError(await res.text().catch(() => "Submit failed"));
        return;
      }
      setDone(true);
    } catch {
      setSubmitError("Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
        style={{ background: PAGE_BG }}
      >
        <div className="max-w-lg rounded-2xl border border-[#16A34A]/40 bg-[#0a1815]/90 px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#16A34A]/20 text-[#4ade80]">
            <span className="text-3xl leading-none">✓</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Thank you. Your responses have been recorded.
          </h2>
        </div>
      </div>
    );
  }

  if (loadStatus === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ background: PAGE_BG }}
      >
        <p className="text-[#c7eae4]">Loading form…</p>
      </div>
    );
  }

  if (loadStatus === "already_completed") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6 text-center"
        style={{ background: PAGE_BG }}
      >
        <div className="max-w-md rounded-2xl border border-[#16A34A]/30 bg-[#0a1815]/90 px-6 py-8">
          <p className="text-lg font-medium text-white">
            This form has already been completed.
          </p>
        </div>
      </div>
    );
  }

  if (loadStatus === "not_found" || loadStatus === "error" || !formConfig || !formType) {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6 text-center"
        style={{ background: PAGE_BG }}
      >
        <div className="max-w-md rounded-2xl border border-red-400/30 bg-[#0a1815]/90 px-6 py-8">
          <p className="text-lg font-medium text-white">
            {loadStatus === "not_found" ? "Link not found." : "Could not load form."}
          </p>
          {loadError ? (
            <p className="mt-2 text-sm text-[#c7eae4]/80">{loadError}</p>
          ) : null}
        </div>
      </div>
    );
  }

  const greeting = patientFirstName ? `Hi ${patientFirstName},` : "Hello,";

  return (
    <div
      className="min-h-screen px-4 pb-16 pt-8 sm:px-6"
      style={{ background: PAGE_BG }}
    >
      <div className="mx-auto max-w-lg">
        <div className="mb-8 text-center">
          <Image
            src="/altheon-logo-white.png"
            alt="Altheon"
            width={220}
            height={60}
            priority
            className="mx-auto h-14 w-auto"
          />
        </div>

        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {formTypeTitle(formType)}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#c7eae4]/95">
            {greeting} please answer each question based on how you have felt
            recently.
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
          {formConfig.questions.map((q, idx) => (
            <fieldset
              key={q.id}
              className="rounded-2xl border border-[#16A34A]/25 bg-[#0a1815]/70 p-4 shadow-sm"
            >
              <legend className="mb-3 px-1 text-sm font-semibold text-white">
                {idx + 1}. {q.text}
              </legend>
              <div className="space-y-2">
                {formConfig.options.map((opt) => {
                  const checked = answers[idx] === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={[
                        "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition",
                        checked
                          ? "border-[#16A34A] bg-[#16A34A]/15 text-white"
                          : "border-[#1e3d38] bg-[#071210]/60 text-[#c7eae4] hover:border-[#16A34A]/50",
                      ].join(" ")}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        value={opt.value}
                        checked={checked}
                        onChange={() => setAnswer(idx, opt.value)}
                        className="h-4 w-4 shrink-0 accent-[#16A34A]"
                      />
                      <span>{opt.label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {submitError ? (
            <p className="rounded-xl border border-red-400/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {submitError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!allAnswered || submitting}
            className="w-full rounded-xl px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </form>
      </div>
    </div>
  );
}

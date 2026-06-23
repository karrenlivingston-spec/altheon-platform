"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

const API_BASE = "https://altheon-platform.onrender.com";

const INPUT_CLASS =
  "w-full rounded-[10px] border-[1.5px] border-[#e2e8f0] px-4 py-3 text-[0.95rem] text-gray-900 transition-all duration-150 placeholder:text-gray-400 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[rgba(22,163,74,0.2)]";

const PRIMARY_BTN =
  "w-full rounded-[10px] bg-[#16A34A] py-3.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(22,163,74,0.3)] transition-all duration-200 ease-in-out hover:-translate-y-px hover:bg-[#15803D] disabled:opacity-60";

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const token = useMemo(
    () => (searchParams.get("token") ?? "").trim(),
    [searchParams],
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const missingToken = !token;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (missingToken) return;

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/staff/accept-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          password,
        }),
      });

      if (res.ok) {
        setSuccess(true);
        return;
      }

      if (res.status === 400) {
        setError("This invite link is invalid or has expired.");
        return;
      }

      if (res.status === 500) {
        setError("Something went wrong. Please try again or contact support.");
        return;
      }

      setError("Something went wrong. Please try again or contact support.");
    } catch {
      setError("Something went wrong. Please try again or contact support.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f0f4f8] px-6 py-12">
      <div
        className="w-full max-w-md rounded-[20px] border border-black/5 bg-white p-10 md:p-12"
        style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.12)" }}
      >
        <div className="mb-6 text-center">
          <span className="text-sm font-semibold uppercase tracking-widest text-gray-400">
            Altheon
          </span>
          <h1 className="mt-3 text-2xl font-bold text-[#0f172a]">
            Accept your invite
          </h1>
          <p className="mt-1 text-sm text-[#64748b]">
            Complete your account setup to join your clinic team
          </p>
        </div>

        {missingToken ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800">
            Invalid invite link. Please contact your administrator.
          </p>
        ) : success ? (
          <div className="space-y-6 text-center">
            <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Your account has been created! You can now log in.
            </p>
            <Link href="/login" className={`${PRIMARY_BTN} inline-block text-center`}>
              Go to login
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label
                htmlFor="first-name"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                First Name
              </label>
              <input
                id="first-name"
                type="text"
                autoComplete="given-name"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="last-name"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Last Name
              </label>
              <input
                id="last-name"
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="confirm-password"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            {error ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}

            <button type="submit" disabled={submitting} className={PRIMARY_BTN}>
              {submitting ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          Loading...
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}

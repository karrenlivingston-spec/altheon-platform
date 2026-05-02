"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(false);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setSubmitting(false);
    if (signInError) {
      setError(true);
      return;
    }
    router.replace("/admin");
  }

  const inputClassName =
    "h-11 w-full rounded-lg border border-gray-300 px-3 text-gray-900 transition focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Left brand panel */}
      <div
        className="relative flex h-40 w-full shrink-0 flex-col items-center justify-center px-6 md:h-auto md:min-h-screen md:w-[40%]"
        style={{
          background: "linear-gradient(135deg, #14532d 0%, #166534 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_40%)]"
          aria-hidden
        />
        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="flex flex-col items-center justify-center gap-8 h-full">
            <img
              src="/altheon-logo-white.svg"
              alt="Altheon"
              className="w-[320px] max-w-none"
            />
          </div>
          <p className="mt-4 text-center text-sm text-white opacity-80">
            AI-powered clinic operations platform
          </p>
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-gray-50 px-6 py-8 md:min-h-screen md:w-[60%] md:px-8 md:py-12">
        <div className="mx-auto w-full max-w-md rounded-xl bg-white p-8 shadow-xl">
          <h1 className="mb-1 text-2xl font-semibold text-gray-900">Sign in</h1>
          <p className="mb-6 text-sm text-gray-500">
            Enter your credentials to continue
          </p>
          <form onSubmit={handleSubmit}>
            <label
              htmlFor="admin-email"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={`${inputClassName} mb-4`}
            />
            <label
              htmlFor="admin-password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={`${inputClassName} mb-6`}
            />
            <button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-lg bg-[#166534] font-medium text-white transition hover:bg-[#14532d] disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>
            {error ? (
              <p className="mt-3 text-center text-sm text-red-600">
                Invalid email or password.
              </p>
            ) : null}
            <p
              className={`text-center text-sm text-gray-500 ${error ? "mt-3" : "mt-4"}`}
            >
              Secure access for clinic staff
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

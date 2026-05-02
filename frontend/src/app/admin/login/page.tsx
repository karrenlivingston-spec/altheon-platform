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
    "h-11 w-full rounded-lg border border-gray-300 px-3 text-gray-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-[#166534]";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Left — brand */}
      <aside className="relative flex w-full shrink-0 flex-col bg-gradient-to-br from-[#14532d] to-[#166534] md:w-[34%] md:min-h-screen">
        <div
          className="pointer-events-none absolute inset-0 bg-white/5 blur-3xl"
          aria-hidden
        />
        <div className="relative z-10 flex h-full min-h-0 flex-col items-center justify-center px-12 py-12 md:min-h-screen md:py-0">
          <div className="flex flex-col items-center justify-center gap-8 h-full -translate-y-16">
            <img
              src="/altheon-logo-white.svg"
              alt="Altheon"
              className="w-[460px] max-w-none"
            />
            <p className="text-white text-lg font-semibold opacity-90 text-center tracking-wide">
              AI-powered clinic operations platform
            </p>
          </div>
        </div>
      </aside>

      {/* Right — auth */}
      <div className="flex w-full flex-1 flex-col items-center justify-center bg-[#f8fafc] px-6 md:w-[62%] md:min-h-screen">
        <div className="w-[440px] max-w-full rounded-2xl bg-white p-10 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
          <div className="space-y-6">
            <img
              src="/altheon-logo-full.svg"
              alt="Altheon"
              className="mx-auto block w-[150px]"
            />
            <h1 className="text-center text-2xl font-semibold text-gray-900">
              Sign in
            </h1>
            <p className="text-center text-sm text-gray-500">
              Enter your credentials to continue
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
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
                  className={inputClassName}
                />
              </div>
              <div>
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
                  className={inputClassName}
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="h-11 w-full rounded-lg bg-[#166534] font-medium text-white transition hover:bg-[#14532d] disabled:opacity-60"
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>
              {error ? (
                <p className="text-center text-sm text-red-600">
                  Invalid email or password.
                </p>
              ) : null}
            </form>
            <p className="pt-2 text-center text-xs text-gray-500">
              Secure access for clinic staff
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 transition-colors duration-150 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";

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

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Left — brand */}
      <aside
        className="flex w-full shrink-0 flex-col border-r border-white/5 md:w-[40%] md:min-h-screen lg:w-[38%]"
        style={{
          background: "linear-gradient(180deg, #0B1A2B 0%, #0E2238 100%)",
        }}
      >
        <div className="flex flex-1 flex-col items-center justify-center px-10 py-14 text-center md:min-h-screen md:py-16">
          <img
            src="/altheon-logo-white.svg"
            alt="Altheon"
            className="mx-auto w-[min(220px,70vw)] max-w-full"
          />
          <p className="mt-3 text-sm text-slate-400">
            AI-powered clinic operations platform
          </p>
        </div>
      </aside>

      {/* Right — auth */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[#F8FAFC] px-6 py-12 md:min-h-screen md:py-8">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <img
            src="/altheon-logo.svg"
            alt="Altheon"
            className="mx-auto block h-8 w-auto"
          />
          <h1 className="mt-4 text-center text-xl font-semibold text-gray-900">
            Sign in
          </h1>
          <p className="mt-1 text-center text-sm text-gray-500">
            Enter your credentials to continue
          </p>

          <form onSubmit={handleSubmit} className="mt-6">
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
                className={INPUT_CLASS}
              />
            </div>
            <div className="mt-4">
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
                className={INPUT_CLASS}
              />
            </div>
            <div className="mt-2 text-right">
              <a
                href="#"
                className="text-xs text-gray-400 transition-colors duration-150 hover:text-gray-600"
                onClick={(e) => e.preventDefault()}
              >
                Forgot password?
              </a>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-6 w-full rounded-lg bg-[#16A34A] py-2.5 font-medium text-white transition-colors duration-150 hover:bg-[#15803D] disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>
            {error ? (
              <p className="mt-3 text-center text-sm text-red-600">
                Invalid email or password.
              </p>
            ) : null}
          </form>

          <p className="mt-4 text-center text-xs text-gray-400">
            Secure access for clinic staff
          </p>
        </div>
      </div>
    </div>
  );
}

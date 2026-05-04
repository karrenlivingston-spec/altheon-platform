"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 transition-all duration-150 placeholder:text-gray-400 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-green-500/20";

const CARD_SHADOW = "0 4px 24px rgba(0,0,0,0.06)";

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
        className="relative flex w-full shrink-0 flex-col border-r border-white/5 md:w-[40%] md:min-h-screen lg:w-[38%]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 70% at 30% 50%, rgba(22,163,74,0.12) 0%, transparent 60%), linear-gradient(160deg, #0B1A2B 0%, #0D2D1F 60%, #0F3D2A 100%)",
        }}
      >
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-10 py-14 text-center md:min-h-screen md:py-16">
          <img
            src="/altheon-logo-full.png"
            alt="Altheon"
            width={180}
            height={60}
            className="mx-auto w-[180px] max-w-full object-contain"
          />
          <p className="mt-4 text-center text-sm tracking-wide text-slate-400">
            AI-powered clinic operations
          </p>
        </div>
      </aside>

      {/* Right — auth */}
      <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-[#F8FAFC] px-6 py-12 md:py-8">
        <div
          className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-10"
          style={{ boxShadow: CARD_SHADOW }}
        >
          <img
            src="/altheon-logo.svg"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-6 block h-12 w-12"
            aria-hidden
          />
          <h1 className="text-center text-2xl font-bold text-gray-900">
            Welcome back
          </h1>
          <p className="mb-8 mt-1 text-center text-sm text-gray-500">
            Sign in to Altheon
          </p>

          <form onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="admin-email"
                className="mb-1.5 block text-sm font-medium text-gray-700"
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
                placeholder="you@example.com"
                className={INPUT_CLASS}
              />
            </div>
            <div className="mt-4">
              <label
                htmlFor="admin-password"
                className="mb-1.5 block text-sm font-medium text-gray-700"
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
                placeholder="••••••••"
                className={INPUT_CLASS}
              />
            </div>
            <div className="mt-1.5 text-right">
              <a
                href="#"
                className="text-xs text-gray-400 transition-colors duration-150 hover:text-[#16A34A]"
                onClick={(e) => e.preventDefault()}
              >
                Forgot password?
              </a>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="mt-6 w-full rounded-lg bg-[#16A34A] py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-[#15803D] hover:shadow-md active:bg-[#14532D] disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>
            {error ? (
              <p className="mt-3 text-center text-sm text-red-600">
                Invalid email or password.
              </p>
            ) : null}
          </form>

          <div className="mt-6 border-t border-gray-100" aria-hidden />

          <p className="mt-4 text-center text-xs text-gray-400">
            Secure access for clinic staff
          </p>
        </div>
      </div>
    </div>
  );
}

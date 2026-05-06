"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

const INPUT_CLASS =
  "w-full rounded-[10px] border-[1.5px] border-[#e2e8f0] px-4 py-3 text-[0.95rem] text-gray-900 transition-all duration-150 placeholder:text-gray-400 focus:border-[#16A34A] focus:outline-none focus:ring-2 focus:ring-[rgba(22,163,74,0.2)]";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leftBrandAsset, setLeftBrandAsset] = useState<"png" | "svg" | "text">(
    "png",
  );

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
          background: "linear-gradient(145deg, #0a2420 0%, #0b1f2d 100%)",
        }}
      >
        <div
          className="pointer-events-none absolute -left-14 top-10 z-0 h-72 w-72 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(22,163,74,0.1) 0%, transparent 70%)",
            animation: "loginPulse 8s ease-in-out infinite alternate",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-10 bottom-16 z-0 h-80 w-80 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(14,165,164,0.08) 0%, transparent 70%)",
            animation: "loginPulse 8s ease-in-out infinite alternate",
            animationDelay: "1.8s",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute left-1/3 top-1/3 z-0 h-64 w-64 -translate-x-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(22,163,74,0.06) 0%, transparent 72%)",
            animation: "loginPulse 8s ease-in-out infinite alternate",
            animationDelay: "3.2s",
          }}
          aria-hidden
        />
        <div
          className="relative z-10 flex flex-1 flex-col px-10 py-12 md:min-h-screen md:px-12 md:py-14"
        >
          <div className="flex items-start justify-start">
            {leftBrandAsset === "text" ? (
              <p className="text-left text-4xl font-bold text-white" style={{ letterSpacing: "-1px" }}>
                Altheon
              </p>
            ) : (
              <img
                src={
                  leftBrandAsset === "png"
                    ? "/altheon-logo-white.png"
                    : "/altheon-logo-white.svg"
                }
                alt="Altheon"
                width={330}
                height={110}
                className="w-[330px] max-w-full object-contain"
                onError={() =>
                  setLeftBrandAsset((s) => (s === "png" ? "svg" : "text"))
                }
              />
            )}
          </div>

          <div className="mt-12 max-w-md">
            <h2 className="text-4xl font-bold leading-tight text-white">
              Every call answered.
              <br />
              Every slot filled.
            </h2>
            <p className="mt-4 text-sm text-[rgba(255,255,255,0.7)]">
              Built for the modern practice.
            </p>
          </div>

          <div className="mt-8 flex w-full max-w-md flex-col gap-3">
            {[
              ["📞", "Aria answers every call, 24/7"],
              ["📅", "Real-time scheduling, zero double-bookings"],
              ["📋", "AI intake — patients arrive ready"],
              ["💬", "Automated reminders and follow-ups"],
            ].map(([icon, text], idx) => (
              <div
                key={text}
                className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/[0.07] px-4 py-3 opacity-0"
                style={{
                  animation: "fadeInUp 0.5s ease forwards",
                  animationDelay: `${0.1 + idx * 0.15}s`,
                }}
              >
                <span className="text-base">{icon}</span>
                <span className="text-sm font-medium text-white">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Right — auth */}
      <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-[#f0f4f8] px-6 py-12 md:py-8">
        <div
          className="w-full max-w-md rounded-[20px] border border-black/5 bg-white p-12"
          style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.12)" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginBottom: 24,
            }}
          >
            <span className="text-center text-sm font-semibold uppercase tracking-widest text-gray-400">
              Altheon
            </span>
          </div>
          <h1 className="mt-2 text-center text-2xl font-bold text-[#0f172a]">
            Sign in to your dashboard
          </h1>
          <p className="mb-8 mt-1 text-center text-sm text-[#64748b]">
            Access your clinic operations platform
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
              className="mt-6 w-full rounded-[10px] bg-[#16A34A] py-3.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(22,163,74,0.3)] transition-all duration-200 ease-in-out hover:-translate-y-px hover:bg-[#15803D] disabled:opacity-60"
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

          <p className="mt-4 text-center text-[0.8rem] text-[#94a3b8]">
            Secure access for clinic staff
          </p>
        </div>
      </div>
    </div>
  );
}

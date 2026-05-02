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

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center"
      style={{
        background: "linear-gradient(180deg, #f9fafb 0%, #f3f4f6 100%)",
      }}
    >
      <div className="w-[420px] rounded-xl bg-white p-10 shadow-lg">
        <img
          src="/altheon-logo-full.svg"
          alt="Altheon"
          className="login-logo"
          style={{
            width: "220px",
            minWidth: "220px",
            maxWidth: "220px",
            height: "auto",
            display: "block",
            margin: "0 auto 24px auto",
          }}
        />
        <h1 className="text-center text-xl font-semibold">Sign in</h1>
        <p className="mb-6 text-center text-sm text-gray-500">
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
            className="mb-4 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A47]"
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
            className="mb-6 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 outline-none focus-visible:ring-2 focus-visible:ring-[#1F7A47]"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-[#1F7A47] py-2.5 font-semibold text-white hover:bg-[#2D5E3F] disabled:opacity-60"
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
  );
}

"use client";

import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  Scale,
  Users,
  CreditCard,
  Receipt,
  Briefcase,
  Phone,
  Settings,
} from "lucide-react";

import { supabase } from "@/lib/supabase";

import { AdminClinicProvider } from "./AdminClinicContext";
import AskAltheon from "./components/AskAltheon";
import ClinicSwitcher from "./components/ClinicSwitcher";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginRoute = pathname === "/admin/login";
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (pathname === "/admin/login") {
      return;
    }

    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace("/admin/login");
        return;
      }
      setSession(data.session);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (isLoginRoute) {
    return <>{children}</>;
  }

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <AdminAuthenticatedShell pathname={pathname}>
      {children}
    </AdminAuthenticatedShell>
  );
}

function AdminAuthenticatedShell({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function isNavLinkActive(href: string): boolean {
    return (
      pathname === href ||
      (href !== "/admin" && pathname.startsWith(href))
    );
  }

  function navLinkClass(href: string) {
    const active = isNavLinkActive(href);
    return [
      "block rounded-lg border-l-2 py-3 pl-3 pr-4 text-sm font-medium transition-all duration-200",
      active
        ? "border-green-400 bg-white/5 text-white"
        : "border-transparent text-[#94A3B8] hover:bg-[rgba(255,255,255,0.05)]",
    ].join(" ");
  }

  function navIconClass(href: string): string {
    return isNavLinkActive(href)
      ? "w-4 h-4 shrink-0 text-white"
      : "w-4 h-4 shrink-0 text-[#94A3B8]";
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  return (
    <AdminClinicProvider>
    <div className="min-h-screen bg-[#F8FAFC]">
      <button
        type="button"
        aria-label="Toggle menu"
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-600 bg-[#0F172A] text-white shadow-sm md:hidden"
        onClick={() => setSidebarOpen((o) => !o)}
      >
        <span className="sr-only">Menu</span>
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          {sidebarOpen ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          )}
        </svg>
      </button>

      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="flex min-h-screen">
        <aside
          className={[
            "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/5 text-white transition-transform duration-200 md:static md:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          ].join(" ")}
          style={{
            background: "linear-gradient(180deg, #0B1A2B 0%, #0E2238 100%)",
          }}
        >
          <div className="flex items-center gap-2 px-4 py-5">
            <span className="text-xl font-semibold tracking-wide text-white">
              Altheon
            </span>
          </div>
          <ClinicSwitcher />
          <nav className="flex flex-1 flex-col gap-1 px-3 pb-8 pt-2">
            <Link
              href="/admin"
              className={navLinkClass("/admin")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <LayoutDashboard className={navIconClass("/admin")} aria-hidden />
                Overview
              </span>
            </Link>
            <Link
              href="/admin/appointments"
              className={navLinkClass("/admin/appointments")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <CalendarDays
                  className={navIconClass("/admin/appointments")}
                  aria-hidden
                />
                Appointments
              </span>
            </Link>
            <Link
              href="/admin/legal-requests"
              className={navLinkClass("/admin/legal-requests")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Scale
                  className={navIconClass("/admin/legal-requests")}
                  aria-hidden
                />
                Legal Requests
              </span>
            </Link>
            <Link
              href="/admin/patients"
              className={navLinkClass("/admin/patients")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Users className={navIconClass("/admin/patients")} aria-hidden />
                Patients
              </span>
            </Link>
            <div className="mt-8" aria-hidden />
            <Link
              href="/admin/memberships"
              className={navLinkClass("/admin/memberships")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <CreditCard
                  className={navIconClass("/admin/memberships")}
                  aria-hidden
                />
                Memberships
              </span>
            </Link>
            <Link
              href="/admin/billing"
              className={navLinkClass("/admin/billing")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Receipt className={navIconClass("/admin/billing")} aria-hidden />
                Billing
              </span>
            </Link>
            <Link
              href="/admin/pi-cases"
              className={navLinkClass("/admin/pi-cases")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Briefcase
                  className={navIconClass("/admin/pi-cases")}
                  aria-hidden
                />
                PI Cases
              </span>
            </Link>
            <Link
              href="/admin/voice-agent"
              className={navLinkClass("/admin/voice-agent")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Phone
                  className={navIconClass("/admin/voice-agent")}
                  aria-hidden
                />
                Voice Agent
              </span>
            </Link>
            <Link
              href="/admin/settings"
              className={navLinkClass("/admin/settings")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Settings
                  className={navIconClass("/admin/settings")}
                  aria-hidden
                />
                Settings
              </span>
            </Link>
          </nav>
          <div className="border-t border-slate-700/60 px-3 py-5">
            <button
              type="button"
              onClick={() => {
                setSidebarOpen(false);
                void handleSignOut();
              }}
              className="w-full rounded-lg px-4 py-3 text-left text-sm font-medium text-[#94A3B8] transition-colors hover:bg-[rgba(255,255,255,0.05)]"
            >
              Sign Out
            </button>
          </div>
        </aside>

        <main className="flex min-h-screen flex-1 flex-col bg-transparent md:min-h-0">
          <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-6 pt-16 text-slate-900 md:pt-6">
            {children}
          </div>
        </main>
      </div>
      <AskAltheon />
    </div>
    </AdminClinicProvider>
  );
}

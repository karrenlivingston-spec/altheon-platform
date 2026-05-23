"use client";

import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  ChevronDown,
  Scale,
  Users,
  Layers,
  CreditCard,
  Receipt,
  Briefcase,
  ClipboardList,
  Phone,
  Building2,
  Settings,
  Clock3,
} from "lucide-react";

import { supabase } from "@/lib/supabase";

import { ClinicProvider, useClinic } from "./ClinicContext";
import AskAltheon from "./components/AskAltheon";

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
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f8] text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <AdminAuthenticatedShell pathname={pathname} accessToken={session.access_token}>
      {children}
    </AdminAuthenticatedShell>
  );
}

function AdminAuthenticatedShell({
  children,
  pathname,
  accessToken,
}: {
  children: React.ReactNode;
  pathname: string;
  accessToken: string;
}) {
  return (
    <ClinicProvider accessToken={accessToken}>
      <AdminAuthenticatedShellInner pathname={pathname}>
        {children}
      </AdminAuthenticatedShellInner>
    </ClinicProvider>
  );
}

function AdminAuthenticatedShellInner({
  children,
  pathname,
}: {
  children: React.ReactNode;
  pathname: string;
}) {
  const router = useRouter();
  const {
    clinic_id: clinicId,
    brand_name: brandName,
    role,
    all_clinics: allClinics,
    loading: clinicLoading,
    error: clinicError,
    setClinicId,
  } = useClinic();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clinicMenuOpen, setClinicMenuOpen] = useState(false);

  function isNavLinkActive(href: string): boolean {
    if (href === "/dashboard/clinics") {
      return (
        pathname === "/dashboard/clinics" || pathname === "/admin/clinics"
      );
    }
    if (href === "/admin/settings") {
      return pathname === "/admin/settings";
    }
    if (href === "/admin/settings/availability") {
      return (
        pathname === "/admin/settings/availability" ||
        pathname.startsWith("/admin/settings/availability")
      );
    }
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
        ? "border-l-[3px] border-[#22c55e] bg-[rgba(34,197,94,0.15)] text-white"
        : "border-transparent text-white/65 hover:bg-white/10 hover:text-white/90",
    ].join(" ");
  }

  function navIconClass(href: string): string {
    return isNavLinkActive(href)
      ? "h-4 w-4 shrink-0 text-white"
      : "h-4 w-4 shrink-0 text-white/65";
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  if (clinicLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f8] text-sm text-slate-500">
        Loading clinic…
      </div>
    );
  }

  if (clinicError || !clinicId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f4f8] px-6 text-sm text-red-600">
        {clinicError || "Could not resolve clinic context."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f4f8]">
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
            background: "linear-gradient(160deg, #0f2f2a 0%, #0b1f2d 100%)",
            boxShadow: "inset -1px 0 0 rgba(255,255,255,0.05)",
          }}
        >
          <div className="flex items-center gap-2 px-4 py-5">
            <span className="text-xl font-semibold tracking-wide text-white">
              {brandName}
            </span>
          </div>
          {role === "super_admin" && allClinics.length > 0 ? (
            <div className="relative px-3 pb-3">
              <button
                type="button"
                onClick={() => setClinicMenuOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-left text-sm font-medium text-white shadow-sm transition-colors hover:border-white/15 hover:bg-white/[0.1]"
              >
                <span className="truncate">
                  {allClinics.find((c) => c.id === clinicId)?.brand_name || brandName}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-[#94A3B8] transition-transform duration-200 ${clinicMenuOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
              {clinicMenuOpen ? (
                <ul className="absolute left-3 right-3 top-full z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-white/10 bg-[#0E2238] py-1 shadow-lg ring-1 ring-black/20">
                  {allClinics.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setClinicId(c.id);
                          setClinicMenuOpen(false);
                        }}
                        className={[
                          "w-full px-3 py-2 text-left text-sm transition-colors",
                          c.id === clinicId
                            ? "bg-white/10 font-medium text-white"
                            : "text-[#CBD5E1] hover:bg-white/[0.08] hover:text-white",
                        ].join(" ")}
                      >
                        {c.brand_name || c.slug || c.id}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <nav className="flex flex-1 flex-col gap-1 px-3 py-8">
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
            <Link
              href="/admin/groups"
              className={navLinkClass("/admin/groups")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Layers className={navIconClass("/admin/groups")} aria-hidden />
                Groups
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
              href="/admin/clinical-notes"
              className={navLinkClass("/admin/clinical-notes")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <ClipboardList
                  className={navIconClass("/admin/clinical-notes")}
                  aria-hidden
                />
                Clinical Notes
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
            {role === "super_admin" ? (
              <Link
                href="/dashboard/clinics"
                className={navLinkClass("/dashboard/clinics")}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="flex items-center gap-3">
                  <Building2
                    className={navIconClass("/dashboard/clinics")}
                    aria-hidden
                  />
                  Clinics
                </span>
              </Link>
            ) : null}
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
            <Link
              href="/admin/settings/availability"
              className={navLinkClass("/admin/settings/availability")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Clock3
                  className={navIconClass("/admin/settings/availability")}
                  aria-hidden
                />
                Availability
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
              className="w-full rounded-lg px-4 py-3 text-left text-sm font-medium text-white/65 transition-colors hover:bg-white/10 hover:text-white/90"
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
  );
}

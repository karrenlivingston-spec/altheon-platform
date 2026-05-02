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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- no Settings route yet; keep import per design spec
  Settings,
} from "lucide-react";

import { supabase } from "@/lib/supabase";

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
      <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5] text-sm text-neutral-600">
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

  function navLinkClass(href: string) {
    const active =
      pathname === href ||
      (href !== "/admin" && pathname.startsWith(href));
    return [
      "block rounded-lg px-4 py-3 text-sm font-medium transition-colors",
      active
        ? "bg-white/15 text-white"
        : "text-white/90 hover:bg-white/10",
    ].join(" ");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  return (
    <div className="min-h-screen bg-white">
      <button
        type="button"
        aria-label="Toggle menu"
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-md border border-white/20 bg-green-700 text-white shadow-sm md:hidden"
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
            "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 bg-green-700 text-white transition-transform duration-200 md:static md:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          ].join(" ")}
        >
          <div className="flex items-center gap-2 px-4 py-5">
            <span className="text-white font-semibold text-xl tracking-wide">
              Altheon
            </span>
          </div>
          <nav className="flex flex-1 flex-col gap-2 px-3 py-6">
            <Link
              href="/admin"
              className={navLinkClass("/admin")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <LayoutDashboard className="w-4 h-4 shrink-0" aria-hidden />
                Overview
              </span>
            </Link>
            <Link
              href="/admin/appointments"
              className={navLinkClass("/admin/appointments")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <CalendarDays className="w-4 h-4 shrink-0" aria-hidden />
                Appointments
              </span>
            </Link>
            <Link
              href="/admin/legal-requests"
              className={navLinkClass("/admin/legal-requests")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Scale className="w-4 h-4 shrink-0" aria-hidden />
                Legal Requests
              </span>
            </Link>
            <Link
              href="/admin/patients"
              className={navLinkClass("/admin/patients")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Users className="w-4 h-4 shrink-0" aria-hidden />
                Patients
              </span>
            </Link>
            <Link
              href="/admin/memberships"
              className={navLinkClass("/admin/memberships")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <CreditCard className="w-4 h-4 shrink-0" aria-hidden />
                Memberships
              </span>
            </Link>
            <Link
              href="/admin/billing"
              className={navLinkClass("/admin/billing")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Receipt className="w-4 h-4 shrink-0" aria-hidden />
                Billing
              </span>
            </Link>
            <Link
              href="/admin/pi-cases"
              className={navLinkClass("/admin/pi-cases")}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="flex items-center gap-3">
                <Briefcase className="w-4 h-4 shrink-0" aria-hidden />
                PI Cases
              </span>
            </Link>
          </nav>
          <div className="border-t border-white/10 px-3 py-5">
            <button
              type="button"
              onClick={() => {
                setSidebarOpen(false);
                void handleSignOut();
              }}
              className="w-full rounded-lg px-4 py-3 text-left text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
            >
              Sign Out
            </button>
          </div>
        </aside>

        <main className="flex min-h-screen flex-1 flex-col bg-white md:min-h-0">
          <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-6 pt-16 md:pt-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navClass =
    "block rounded-md px-3 py-2 text-sm font-medium text-white/95 hover:bg-white/10 transition-colors";

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <button
        type="button"
        aria-label="Toggle menu"
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-md border border-white/20 bg-[#2D5E3F] text-white shadow md:hidden"
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
            "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 bg-[#2D5E3F] text-white transition-transform duration-200 md:static md:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          ].join(" ")}
        >
          <div className="border-b border-white/10 px-5 py-6">
            <p className="text-lg font-semibold tracking-tight">Altheon</p>
          </div>
          <nav className="flex flex-col gap-1 px-3 py-4">
            <Link href="/admin" className={navClass} onClick={() => setSidebarOpen(false)}>
              Overview
            </Link>
            <a href="#" className={navClass}>
              Appointments
            </a>
            <a href="#" className={navClass}>
              Patients
            </a>
          </nav>
        </aside>

        <main className="flex min-h-screen flex-1 flex-col md:min-h-0">
          <div className="flex-1 bg-white p-4 pt-16 md:p-8 md:pt-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { useAdminClinic } from "@/app/admin/AdminClinicContext";

export default function ClinicSwitcher() {
  const { clinics, clinicId, clinicName, setClinicId, clinicsLoading } =
    useAdminClinic();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const selectClinic = useCallback(
    (id: string) => {
      setClinicId(id);
      setOpen(false);
    },
    [setClinicId],
  );

  return (
    <div ref={rootRef} className="relative px-3 pb-3">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={clinicsLoading || clinics.length === 0}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-left text-sm font-medium text-white shadow-sm transition-colors hover:border-white/15 hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate">
          {clinicsLoading ? "Loading clinics…" : clinicName}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#94A3B8] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {open && clinics.length > 0 ? (
        <ul
          className="absolute left-3 right-3 top-full z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-white/10 bg-[#0E2238] py-1 shadow-lg ring-1 ring-black/20"
          role="listbox"
        >
          {clinics.map((c) => {
            const active = c.id === clinicId;
            return (
              <li key={c.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => selectClinic(c.id)}
                  className={[
                    "w-full px-3 py-2 text-left text-sm transition-colors",
                    active
                      ? "bg-white/10 font-medium text-white"
                      : "text-[#CBD5E1] hover:bg-white/[0.08] hover:text-white",
                  ].join(" ")}
                >
                  {c.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

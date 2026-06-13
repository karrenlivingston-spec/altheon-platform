"use client";

import { useEffect, useMemo, useState } from "react";
import { Grid3X3, List, Phone, User } from "lucide-react";

import { PatientDetailView } from "@/components/admin/PatientDetailView";
import {
  formatDob,
  patientDisplayName,
  patientInitials,
} from "@/components/admin/patients/patientTypes";
import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_INPUT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type PatientRow = {
  id: string;
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  created_at?: string | null;
};

type SortOption = "last_name_az";

function normalizePhone(s: string): string {
  return s.replace(/\D/g, "");
}

function sortPatients(list: PatientRow[], sort: SortOption): PatientRow[] {
  const copy = [...list];
  if (sort === "last_name_az") {
    copy.sort((a, b) => {
      const la = (a.last_name ?? "").trim().toLowerCase();
      const lb = (b.last_name ?? "").trim().toLowerCase();
      const cmp = la.localeCompare(lb);
      if (cmp !== 0) return cmp;
      return (a.first_name ?? "").trim().localeCompare((b.first_name ?? "").trim());
    });
  }
  return copy;
}

export default function AdminPatientsPage() {
  const { clinicId } = useClinic();
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("last_name_az");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    patientId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ptRes = await fetch(
          `${API_BASE}/patients?clinic_id=${encodeURIComponent(clinicId)}`,
        );
        const ptJson = ptRes.ok ? await ptRes.json() : [];
        if (!cancelled) {
          setPatients(Array.isArray(ptJson) ? ptJson : []);
        }
      } catch {
        if (!cancelled) setPatients([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qPhone = normalizePhone(search);
    const filtered = patients.filter((p) => {
      if (!q && !qPhone) return true;
      const name = patientDisplayName(p).toLowerCase();
      const phone = String(p.phone ?? "");
      const phoneNorm = normalizePhone(phone);
      if (q && (name.includes(q) || phone.toLowerCase().includes(q))) return true;
      if (qPhone && phoneNorm.includes(qPhone)) return true;
      return false;
    });
    return sortPatients(filtered, sort);
  }, [patients, search, sort]);

  const filteredCount = filteredList.length;

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100vh-3rem)] min-h-0 w-[calc(100%+3rem)] max-w-none flex-col md:flex-row">
      <aside
        className={`flex h-full min-h-0 w-full shrink-0 flex-col border-[#e2e8f0] bg-white md:w-[340px] md:border-r ${
          selectedId ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="border-b border-[#e2e8f0] p-4">
          <h1 className={DS_PAGE_TITLE}>Patients</h1>
          <p className={DS_PAGE_SUBTITLE}>Directory and visit history</p>
          <input
            type="search"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${DS_INPUT} mt-4 w-full`}
            aria-label="Search patients"
          />
          <div className="mt-3 flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className={`${DS_INPUT} flex-1`}
              aria-label="Sort patients"
            >
              <option value="last_name_az">Last Name (A-Z)</option>
            </select>
            <div className="flex shrink-0 rounded-lg border border-gray-200 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-md p-1.5 ${
                  viewMode === "list"
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                aria-label="List view"
                aria-pressed={viewMode === "list"}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={`rounded-md p-1.5 ${
                  viewMode === "grid"
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-400 hover:text-gray-600"
                }`}
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-[#64748b]">
              {loading ? "…" : `${filteredCount} Patient${filteredCount === 1 ? "" : "s"}`}
            </p>
            <button type="button" className={`${DS_SECONDARY_BTN} shrink-0 py-1.5 text-xs`}>
              + New Patient
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-[#64748b]">Loading…</p>
          ) : filteredList.length === 0 ? (
            <p className="p-4 text-sm text-[#64748b]">No patients match your search.</p>
          ) : viewMode === "grid" ? (
            <ul className="grid grid-cols-2 gap-2 p-3">
              {filteredList.map((p) => {
                const selected = selectedId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`flex w-full flex-col items-center rounded-xl border p-3 text-center transition-colors hover:bg-[rgba(22,163,74,0.06)] ${
                        selected
                          ? "border-[#16A34A] bg-[rgba(22,163,74,0.12)]"
                          : "border-[#e2e8f0]"
                      }`}
                    >
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                        style={{ backgroundColor: "#16A34A" }}
                      >
                        {patientInitials(p)}
                      </span>
                      <p className="mt-2 truncate text-sm font-bold text-[#0f172a]">
                        {patientDisplayName(p)}
                      </p>
                      <span className="mt-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                        Active
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="divide-y divide-[#e2e8f0]">
              {filteredList.map((p) => {
                const selected = selectedId === p.id;
                const dobGender = [
                  p.date_of_birth ? formatDob(p.date_of_birth) : null,
                  p.gender?.trim() || null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          patientId: p.id,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                      className={`flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-[rgba(22,163,74,0.06)] ${
                        selected
                          ? "border-l-[3px] border-l-[#16A34A] bg-[rgba(22,163,74,0.12)]"
                          : "border-l-[3px] border-l-transparent"
                      }`}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                        style={{ backgroundColor: "#16A34A" }}
                      >
                        {patientInitials(p)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-bold text-[#0f172a]">
                            {patientDisplayName(p)}
                          </p>
                          <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                            Active
                          </span>
                        </div>
                        {dobGender ? (
                          <p className="mt-0.5 text-[0.8rem] text-[#64748b]">{dobGender}</p>
                        ) : null}
                        <p className="mt-0.5 flex items-center gap-1 text-[0.8rem] text-[#64748b]">
                          <Phone className="h-3 w-3 shrink-0" aria-hidden />
                          {p.phone?.trim() || "—"}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <section
        className={`min-h-0 flex-1 overflow-hidden bg-[#f8fafc] ${
          selectedId ? "flex" : "hidden md:flex"
        } flex-col`}
      >
        {!selectedId ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
            <User className="h-16 w-16 text-gray-300" strokeWidth={1.25} />
            <p className="mt-4 text-sm font-medium text-[#64748b]">
              Select a patient to view their profile
            </p>
          </div>
        ) : (
          <PatientDetailView
            key={selectedId}
            patientId={selectedId}
            clinicId={clinicId}
            embedded
            onBack={() => setSelectedId(null)}
          />
        )}
      </section>

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[168px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
            onClick={() => {
              window.open(`/admin/patients/${contextMenu.patientId}`, "_blank");
              setContextMenu(null);
            }}
          >
            Open in new tab
          </button>
        </div>
      ) : null}
    </div>
  );
}

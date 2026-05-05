"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { supabase } from "@/lib/supabase";

/** Default clinic (STTPDN) on first load when nothing is stored. */
export const DEFAULT_ADMIN_CLINIC_ID =
  "804e2fd2-1c5e-49ec-a036-3feedd1bad50";

const STORAGE_KEY = "altheon_admin_selected_clinic_id";

export type AdminClinicRow = { id: string; name: string };

type AdminClinicContextValue = {
  clinics: AdminClinicRow[];
  clinicId: string;
  clinicName: string;
  setClinicId: (id: string) => void;
  clinicsLoading: boolean;
};

const AdminClinicContext = createContext<AdminClinicContextValue | null>(null);

export function AdminClinicProvider({ children }: { children: React.ReactNode }) {
  const [clinics, setClinics] = useState<AdminClinicRow[]>([]);
  const [clinicId, setClinicIdState] = useState(DEFAULT_ADMIN_CLINIC_ID);
  const [clinicsLoading, setClinicsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("clinics")
        .select("id,name")
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error(error);
        setClinics([]);
        setClinicsLoading(false);
        return;
      }
      const rows = (data ?? []) as AdminClinicRow[];
      setClinics(rows);
      const ids = new Set(rows.map((r) => r.id));
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        stored = null;
      }
      if (stored && ids.has(stored)) {
        setClinicIdState(stored);
      } else if (ids.has(DEFAULT_ADMIN_CLINIC_ID)) {
        setClinicIdState(DEFAULT_ADMIN_CLINIC_ID);
      } else if (rows[0]) {
        setClinicIdState(rows[0].id);
      }
      setClinicsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setClinicId = useCallback((id: string) => {
    setClinicIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const clinicName = useMemo(() => {
    const row = clinics.find((c) => c.id === clinicId);
    return row?.name ?? "Clinic";
  }, [clinics, clinicId]);

  const value = useMemo(
    () => ({
      clinics,
      clinicId,
      clinicName,
      setClinicId,
      clinicsLoading,
    }),
    [clinics, clinicId, clinicName, setClinicId, clinicsLoading],
  );

  return (
    <AdminClinicContext.Provider value={value}>
      {children}
    </AdminClinicContext.Provider>
  );
}

export function useAdminClinic() {
  const ctx = useContext(AdminClinicContext);
  if (!ctx) {
    throw new Error("useAdminClinic must be used within AdminClinicProvider");
  }
  return ctx;
}

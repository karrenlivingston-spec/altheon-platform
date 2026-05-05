"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/** Default clinic (STTPDN) on first load when nothing is stored. */
export const DEFAULT_ADMIN_CLINIC_ID =
  "804e2fd2-1c5e-49ec-a036-3feedd1bad50";

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
  const [clinics] = useState<AdminClinicRow[]>([
    { id: DEFAULT_ADMIN_CLINIC_ID, name: "STTPDN" },
  ]);
  const [clinicId, setClinicIdState] = useState(DEFAULT_ADMIN_CLINIC_ID);
  const clinicsLoading = false;

  const setClinicId = useCallback((id: string) => {
    if (id === DEFAULT_ADMIN_CLINIC_ID) {
      setClinicIdState(DEFAULT_ADMIN_CLINIC_ID);
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

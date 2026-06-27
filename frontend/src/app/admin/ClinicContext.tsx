"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ClinicSummary = {
  id: string;
  slug: string | null;
  brand_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  agent_name: string | null;
};

export type MeResponse = {
  user_id: string;
  /** `clinic_users.id` for the current clinic (use as clinical_notes.author_id). */
  clinic_user_id?: string;
  role: string;
  billing_only?: boolean;
  clinic: ClinicSummary;
  all_clinics?: ClinicSummary[];
};

type ClinicContextValue = {
  /** Full JSON from `GET /me` (clinic may update when super_admin switches). */
  me: MeResponse | null;
  clinic_id: string;
  clinicId: string;
  slug: string;
  brand_name: string;
  logo_url: string | null;
  primary_color: string;
  agent_name: string;
  role: string;
  billing_only: boolean;
  all_clinics: ClinicSummary[];
  loading: boolean;
  error: string | null;
  setClinicId: (id: string) => void;
};

const ME_API_URL = "https://altheon-platform.onrender.com/me";

const ClinicContext = createContext<ClinicContextValue | null>(null);

function normalizeClinic(clinic: ClinicSummary) {
  return {
    clinic_id: clinic.id,
    clinicId: clinic.id,
    slug: (clinic.slug ?? "").trim(),
    brand_name: (clinic.brand_name ?? "").trim() || "Altheon",
    logo_url: clinic.logo_url ?? null,
    primary_color: (clinic.primary_color ?? "").trim() || "#16A34A",
    agent_name: (clinic.agent_name ?? "").trim() || "Aria",
  };
}

export function ClinicProvider({
  accessToken,
  children,
}: {
  accessToken: string;
  children: React.ReactNode;
}) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(ME_API_URL, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Failed to load /me (${res.status})`);
        }
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        if (!data.clinic || !data.clinic.id) {
          throw new Error("No clinic returned from /me");
        }
        const allClinics = Array.isArray(data.all_clinics) ? data.all_clinics : [];
        const clinics = allClinics.length > 0 ? allClinics : [data.clinic];
        const savedClinicId = localStorage.getItem("altheon_selected_clinic_id");
        let clinic = data.clinic;
        if (savedClinicId && clinics.some((c) => c.id === savedClinicId)) {
          clinic = clinics.find((c) => c.id === savedClinicId) ?? data.clinic;
        }
        setMe({
          ...data,
          clinic,
          role: (data.role ?? "").trim() || "member",
          billing_only: Boolean(data.billing_only),
          all_clinics: allClinics,
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load clinic context");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const clinicState = useMemo(() => {
    if (!me?.clinic) {
      return normalizeClinic({
        id: "",
        slug: "",
        brand_name: "Altheon",
        logo_url: null,
        primary_color: "#16A34A",
        agent_name: "Aria",
      });
    }
    return normalizeClinic(me.clinic);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    document.documentElement.style.setProperty(
      "--color-primary",
      clinicState.primary_color || "#16A34A",
    );
    document.title = clinicState.brand_name || "Altheon";
  }, [me, clinicState.brand_name, clinicState.primary_color]);

  const setClinicId = useCallback(
    (id: string) => {
      setMe((prev) => {
        if (!prev || prev.role !== "super_admin") return prev;
        const target = (prev.all_clinics ?? []).find((c) => c.id === id);
        if (!target) return prev;
        localStorage.setItem("altheon_selected_clinic_id", id);
        return { ...prev, clinic: target };
      });
    },
    [],
  );

  const value = useMemo(
    () => ({
      me,
      ...clinicState,
      role: (me?.role ?? "").trim() || "member",
      billing_only: Boolean(me?.billing_only),
      all_clinics: me?.all_clinics ?? [],
      loading,
      error,
      setClinicId,
    }),
    [me, clinicState, loading, error, setClinicId],
  );

  return <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>;
}

export function useClinic() {
  const ctx = useContext(ClinicContext);
  if (!ctx) {
    throw new Error("useClinic must be used within ClinicProvider");
  }
  return ctx;
}


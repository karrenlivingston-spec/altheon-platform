"use client";

import { useMemo } from "react";

import { useClinic } from "@/app/admin/ClinicContext";

const ADMIN_ROLES = new Set(["super_admin", "clinic_admin"]);
const BILLING_ROLES = new Set(["super_admin", "clinic_admin", "clinician"]);
const CLINICAL_ROLES = new Set(["super_admin", "clinic_admin", "clinician"]);

export function usePermissions() {
  const { role, me, loading } = useClinic();

  return useMemo(() => {
    const normalizedRole = (role || "").trim().toLowerCase();

    const isAdmin = ADMIN_ROLES.has(normalizedRole);
    const isClinician = normalizedRole === "clinician";
    const isFrontDesk = normalizedRole === "front_desk";
    const canAccessBilling = BILLING_ROLES.has(normalizedRole);
    const canViewBilling = canAccessBilling;
    const canViewClaims = canAccessBilling;
    const canSubmitClaims = canAccessBilling;
    const canViewClinicalNotes = CLINICAL_ROLES.has(normalizedRole);
    const canManageStaff = isAdmin;

    return {
      role: normalizedRole,
      userId: me?.user_id ?? "",
      loading,
      isAdmin,
      isClinician,
      isFrontDesk,
      canAccessBilling,
      canViewBilling,
      canViewClaims,
      canSubmitClaims,
      canViewClinicalNotes,
      canManageStaff,
    };
  }, [role, me?.user_id, loading]);
}

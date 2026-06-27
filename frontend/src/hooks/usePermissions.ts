"use client";

import { useMemo } from "react";

import { useClinic } from "@/app/admin/ClinicContext";

const ADMIN_ROLES = new Set(["super_admin", "clinic_admin"]);
const BILLING_ROLES = new Set(["super_admin", "clinic_admin", "clinician", "biller"]);
const CLINICAL_ROLES = new Set(["super_admin", "clinic_admin", "clinician", "biller"]);

export function usePermissions() {
  const { role, me, loading, billing_only } = useClinic();

  return useMemo(() => {
    const normalizedRole = (role || "").trim().toLowerCase();
    const billingOnly = Boolean(billing_only);
    const isBiller = normalizedRole === "biller";
    const isBillingOnly = isBiller && billingOnly;

    const isAdmin = ADMIN_ROLES.has(normalizedRole);
    const isClinician = normalizedRole === "clinician";
    const isFrontDesk = normalizedRole === "front_desk";
    const canAccessBilling = BILLING_ROLES.has(normalizedRole);
    const canViewBilling = canAccessBilling;
    const canViewClaims = canAccessBilling;
    const canSubmitClaims = canAccessBilling;
    const canViewClinicalNotes =
      CLINICAL_ROLES.has(normalizedRole) && !isBillingOnly;
    const canManageStaff = isAdmin;

    return {
      role: normalizedRole,
      userId: me?.user_id ?? "",
      billingOnly,
      loading,
      isBiller,
      isBillingOnly,
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
  }, [role, me?.user_id, loading, billing_only]);
}

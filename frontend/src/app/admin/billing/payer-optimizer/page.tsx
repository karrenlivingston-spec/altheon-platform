"use client";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
} from "@/app/admin/designSystem";
import PayerOptimizerPanel from "@/components/soap/PayerOptimizerPanel";

export default function AdminPayerOptimizerPage() {
  const { clinicId } = useClinic();

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-6">
        <h1 className={DS_PAGE_TITLE}>Payer Optimizer</h1>
        <p className={DS_PAGE_SUBTITLE}>
          CPT recommendations by payer and visit type
        </p>
      </div>
      <PayerOptimizerPanel
        clinicId={clinicId}
        appointmentId=""
        primaryPayer={null}
        secondaryPayer={null}
        visitType="followup"
        onCodesSelected={() => {}}
      />
    </div>
  );
}

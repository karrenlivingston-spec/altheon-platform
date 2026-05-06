"use client";

import { useParams, useRouter } from "next/navigation";

import { PatientDetailView } from "@/components/admin/PatientDetailView";
import { useClinic } from "@/app/admin/ClinicContext";

export default function PatientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { clinicId } = useClinic();
  const patientId = typeof params.id === "string" ? params.id : "";

  return (
    <PatientDetailView
      patientId={patientId}
      clinicId={clinicId}
      embedded={false}
      onBack={() => router.push("/admin/patients")}
    />
  );
}

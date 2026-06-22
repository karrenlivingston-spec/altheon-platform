"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";

import { PatientDetailView, type PageTab } from "@/components/admin/PatientDetailView";
import { useClinic } from "@/app/admin/ClinicContext";

const VALID_TABS = new Set<PageTab>([
  "overview",
  "appointments",
  "clinical",
  "billing",
  "documents",
  "notes",
  "legal",
  "memberships",
  "packages",
  "benefits",
]);

function tabFromParam(value: string | null): PageTab | undefined {
  if (!value || !VALID_TABS.has(value as PageTab)) return undefined;
  return value as PageTab;
}

export default function PatientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { clinicId } = useClinic();
  const patientId = typeof params.id === "string" ? params.id : "";
  const initialTab = tabFromParam(searchParams.get("tab"));

  return (
    <PatientDetailView
      key={`${patientId}-${initialTab ?? "overview"}`}
      patientId={patientId}
      clinicId={clinicId}
      embedded={false}
      initialTab={initialTab}
      onBack={() => router.push("/admin/patients")}
    />
  );
}

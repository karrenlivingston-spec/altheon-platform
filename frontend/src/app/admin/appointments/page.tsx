"use client";

import { useState } from "react";

import CalendarView from "@/components/scheduling/CalendarView";
import PatientFlow from "@/components/scheduling/PatientFlow";
import { useClinic } from "@/app/admin/ClinicContext";
import { DS_PAGE_ROOT, DS_PAGE_SUBTITLE, DS_PAGE_TITLE } from "@/app/admin/designSystem";

function tabClass(active: boolean): string {
  return active
    ? "rounded-lg bg-[#0B1A2B] px-4 py-2 text-sm font-medium text-white"
    : "rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100";
}

export default function AdminAppointmentsPage() {
  const { clinicId } = useClinic();
  const [activeTab, setActiveTab] = useState<"calendar" | "patient_flow">("calendar");
  const [openBookingNonce, setOpenBookingNonce] = useState(0);

  return (
    <div className={`${DS_PAGE_ROOT} mx-auto max-w-7xl`}>
      <h1 className={`${DS_PAGE_TITLE} mb-6 font-bold`}>Scheduling</h1>
      <p className={DS_PAGE_SUBTITLE}>Calendar and patient flow</p>

      <div className="mt-6 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={tabClass(activeTab === "calendar")}
            onClick={() => setActiveTab("calendar")}
          >
            Calendar
          </button>
          <button
            type="button"
            className={tabClass(activeTab === "patient_flow")}
            onClick={() => setActiveTab("patient_flow")}
          >
            Patient Flow
          </button>
        </div>
        <button
          type="button"
          className="rounded-lg bg-[#16A34A] px-4 py-2 text-sm font-medium text-white hover:bg-[#15803D]"
          onClick={() => {
            setActiveTab("calendar");
            setOpenBookingNonce((n) => n + 1);
          }}
        >
          New Appointment
        </button>
      </div>

      {activeTab === "patient_flow" ? (
        <section className="mt-6">
          <PatientFlow />
        </section>
      ) : (
        <section className="mt-6">
          <CalendarView clinicId={clinicId} openBookingNonce={openBookingNonce} />
        </section>
      )}
    </div>
  );
}


"use client";

import { useEffect, useMemo, useState } from "react";

import {
  addDaysToYmd,
  formatTimeEastern,
  getEasternYMD,
  getThisWeekRangeEasternYmd,
  isYmdInInclusiveRange,
} from "@/components/adminEastern";

const CLINIC_ID = "804e2fd2-1c5e-49ec-a036-3feedd1bad50";
const API_BASE = "https://altheon-platform.onrender.com";

const CLINICIAN_WEST_ID = "fb6fa0fc-78f3-48c0-818b-511ad7a8ee93";
const CLINICIAN_SHARPE_ID = "ee6eaa90-1f90-4af7-85a5-4ae78aea3df7";

type ClinicianFilter = "all" | "west" | "sharpe";

type AppointmentRow = {
  id: string;
  patient_id?: string;
  clinician_id: string;
  start_time: string;
  status: string;
  patients?: { first_name?: string; last_name?: string } | null;
  treatment_types?: { name?: string } | null;
};

type PatientListRow = {
  id: string;
  first_name?: string;
  last_name?: string;
};

type BillingTarget = {
  id: string;
  patient_name: string;
  patient_id: string;
  appointment_date: string;
  clinician: string;
};

type QuickBillLineItem = {
  localId: string;
  cpt_code: string;
  description: string;
  units: number;
  rate_cents: number;
  is_timed: boolean;
  payment_type: string;
};

const BILL_MODAL_INPUT =
  "mt-1 h-9 w-full rounded-lg border border-gray-100 bg-white px-3 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500";
const BILL_BTN_CLASS =
  "text-xs font-medium rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900";

function clinicianLabel(id: string): string {
  if (id === CLINICIAN_WEST_ID) return "Dr. West";
  if (id === CLINICIAN_SHARPE_ID) return "Dr. Sharpe";
  return id;
}

function patientName(row: AppointmentRow): string {
  const p = row.patients;
  const full = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim();
  return full || "—";
}

function serviceName(row: AppointmentRow): string {
  return row.treatment_types?.name ?? "—";
}

function normalizeFullName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function patientIdForBilling(
  row: AppointmentRow,
  patientsList: PatientListRow[],
): string {
  if (row.patient_id) return row.patient_id;
  const target = normalizeFullName(patientName(row));
  if (!target || target === "—") return "";
  const hit = patientsList.find((p) => {
    const full = normalizeFullName(
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    );
    return full === target;
  });
  return hit?.id ?? "";
}

function flowCardClinicianBorderClass(clinicianId: string): string {
  if (clinicianId === CLINICIAN_WEST_ID) {
    return "border-l-4 border-l-[#1A6B8A]";
  }
  if (clinicianId === CLINICIAN_SHARPE_ID) {
    return "border-l-4 border-l-[#7C3AED]";
  }
  return "border-l-4 border-l-gray-300";
}

function filterPillClass(isActive: boolean): string {
  const base =
    "cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150";
  if (isActive) {
    return `${base} bg-green-600 text-white`;
  }
  return `${base} bg-gray-100 text-gray-600 hover:bg-gray-200`;
}

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "numeric",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 15, 0, 0)));
}

export default function AdminAppointmentsPage() {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patientsList, setPatientsList] = useState<PatientListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});
  const [clinicianFilter, setClinicianFilter] = useState<ClinicianFilter>("all");

  const [billingModalOpen, setBillingModalOpen] = useState(false);
  const [billingTarget, setBillingTarget] = useState<BillingTarget | null>(null);
  const [billBillingType, setBillBillingType] = useState("cash");
  const [billInsurance, setBillInsurance] = useState("");
  const [billClaim, setBillClaim] = useState("");
  const [billNotes, setBillNotes] = useState("");
  const [billLineItems, setBillLineItems] = useState<QuickBillLineItem[]>([]);
  const [draftCpt, setDraftCpt] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftUnits, setDraftUnits] = useState("1");
  const [draftRate, setDraftRate] = useState("0");
  const [draftTimed, setDraftTimed] = useState(false);
  const [draftPayType, setDraftPayType] = useState("cash");
  const [billSubmitBusy, setBillSubmitBusy] = useState(false);
  const [billModalError, setBillModalError] = useState<string | null>(null);

  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  async function refreshAppointments() {
    try {
      const res = await fetch(
        `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
      );
      const data = res.ok ? await res.json() : [];
      setAppointments(Array.isArray(data) ? data : []);
    } catch {
      setAppointments([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const res = await fetch(
          `${API_BASE}/appointments?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) {
          setAppointments(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setAppointments([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchData();

    const interval = setInterval(() => {
      void fetchData();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/patients?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        );
        const data = res.ok ? await res.json() : [];
        if (!cancelled) {
          setPatientsList(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) {
          setPatientsList([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toastVisible || !toastMessage) return;
    const t = window.setTimeout(() => {
      setToastVisible(false);
      setToastMessage("");
    }, 3000);
    return () => window.clearTimeout(t);
  }, [toastVisible, toastMessage]);

  const filteredAppointments = useMemo(() => {
    if (clinicianFilter === "west") {
      return appointments.filter((a) => a.clinician_id === CLINICIAN_WEST_ID);
    }
    if (clinicianFilter === "sharpe") {
      return appointments.filter((a) => a.clinician_id === CLINICIAN_SHARPE_ID);
    }
    return appointments;
  }, [appointments, clinicianFilter]);

  const todayYmd = useMemo(() => getEasternYMD(new Date()), []);
  const { mon: weekMon, sun: weekSun } = useMemo(
    () => getThisWeekRangeEasternYmd(new Date()),
    [],
  );

  const todayAppointments = useMemo(
    () =>
      filteredAppointments
        .filter((a) => getEasternYMD(new Date(a.start_time)) === todayYmd)
        .sort(
          (a, b) =>
            new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
        ),
    [filteredAppointments, todayYmd],
  );

  const scheduled = todayAppointments.filter((a) => {
    const s = a.status.toLowerCase();
    return s === "scheduled" || s === "cancelled";
  });
  const checkedIn = todayAppointments.filter((a) => a.status === "checked_in");
  const completed = todayAppointments.filter((a) => a.status === "completed");

  const weekAppointments = useMemo(
    () =>
      filteredAppointments.filter((a) =>
        isYmdInInclusiveRange(
          getEasternYMD(new Date(a.start_time)),
          weekMon,
          weekSun,
        ),
      ),
    [filteredAppointments, weekMon, weekSun],
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDaysToYmd(weekMon, idx)),
    [weekMon],
  );

  async function patchStatus(appointmentId: string, status: string) {
    setUpdatingIds((prev) => ({ ...prev, [appointmentId]: true }));
    try {
      const res = await fetch(
        `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/status?clinic_id=${encodeURIComponent(CLINIC_ID)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        return;
      }
      setAppointments((prev) =>
        prev.map((a) => (a.id === appointmentId ? { ...a, status } : a)),
      );
      await refreshAppointments();
    } finally {
      setUpdatingIds((prev) => {
        const next = { ...prev };
        delete next[appointmentId];
        return next;
      });
    }
  }

  function resetQuickBillForm() {
    setBillBillingType("cash");
    setBillInsurance("");
    setBillClaim("");
    setBillNotes("");
    setBillLineItems([]);
    setDraftCpt("");
    setDraftDesc("");
    setDraftUnits("1");
    setDraftRate("0");
    setDraftTimed(false);
    setDraftPayType("cash");
    setBillModalError(null);
  }

  function closeBillingModal() {
    setBillingModalOpen(false);
    setBillingTarget(null);
    resetQuickBillForm();
  }

  function openBillingForAppointment(row: AppointmentRow) {
    const patient_id = patientIdForBilling(row, patientsList);
    resetQuickBillForm();
    setBillingTarget({
      id: row.id,
      patient_name: patientName(row),
      patient_id,
      appointment_date: getEasternYMD(new Date(row.start_time)),
      clinician: clinicianLabel(row.clinician_id),
    });
    setBillingModalOpen(true);
  }

  function appendQuickBillLineItem() {
    const cpt = draftCpt.trim();
    if (!cpt) {
      setBillModalError("CPT code is required to add a line item.");
      return;
    }
    const units = Math.max(1, parseInt(String(draftUnits), 10) || 1);
    const rateDollars = parseFloat(String(draftRate)) || 0;
    const rate_cents = Math.round(rateDollars * 100);
    const item: QuickBillLineItem = {
      localId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      cpt_code: cpt,
      description: draftDesc.trim(),
      units,
      rate_cents,
      is_timed: draftTimed,
      payment_type: draftPayType,
    };
    setBillLineItems((prev) => [...prev, item]);
    setDraftCpt("");
    setDraftDesc("");
    setDraftUnits("1");
    setDraftRate("0");
    setDraftTimed(false);
    setDraftPayType("cash");
    setBillModalError(null);
  }

  function removeQuickBillLineItem(localId: string) {
    setBillLineItems((prev) => prev.filter((x) => x.localId !== localId));
  }

  async function submitQuickBill() {
    if (!billingTarget) return;
    if (!billingTarget.patient_id) {
      setBillModalError(
        "Patient ID could not be resolved. Open Billing to create this record manually.",
      );
      return;
    }
    if (billLineItems.length === 0) {
      setBillModalError("Add at least one line item before submitting.");
      return;
    }
    setBillSubmitBusy(true);
    setBillModalError(null);
    try {
      const body: Record<string, unknown> = {
        clinic_id: CLINIC_ID,
        patient_id: billingTarget.patient_id,
        appointment_id: billingTarget.id,
        date_of_service: billingTarget.appointment_date,
        billing_type: billBillingType,
      };
      if (billBillingType === "insurance" || billBillingType === "mixed") {
        if (billInsurance.trim()) body.insurance_carrier = billInsurance.trim();
        if (billClaim.trim()) body.claim_number = billClaim.trim();
      }
      if (billNotes.trim()) body.notes = billNotes.trim();

      const res = await fetch(`${API_BASE}/billing-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        setBillModalError(
          t ? `Create failed (${res.status}): ${t.slice(0, 240)}` : `Create failed (${res.status})`,
        );
        return;
      }
      const created = (await res.json()) as { id?: string };
      const recordId = created?.id;
      if (!recordId) {
        setBillModalError("Billing record created but no id returned.");
        return;
      }
      for (const li of billLineItems) {
        const liRes = await fetch(
          `${API_BASE}/billing-records/${encodeURIComponent(recordId)}/line-items`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cpt_code: li.cpt_code,
              description: li.description || null,
              units: li.units,
              rate_cents: li.rate_cents,
              is_timed: li.is_timed,
              payment_type: li.payment_type,
            }),
          },
        );
        if (!liRes.ok) {
          const t = await liRes.text().catch(() => "");
          setBillModalError(
            t
              ? `Record created but line item failed (${liRes.status}): ${t.slice(0, 200)}`
              : `Record created but a line item failed (${liRes.status})`,
          );
          return;
        }
      }
      closeBillingModal();
      setToastMessage("Billing record created");
      setToastVisible(true);
    } catch (e) {
      setBillModalError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBillSubmitBusy(false);
    }
  }

  function renderCard(row: AppointmentRow, column: "scheduled" | "checked_in" | "completed") {
    const busy = !!updatingIds[row.id];
    const canCancel = column !== "completed";
    const isCancelledScheduled =
      column === "scheduled" && row.status.toLowerCase() === "cancelled";

    const accent = flowCardClinicianBorderClass(row.clinician_id);
    const cardShell = [
      "rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all duration-150 ease-out hover:-translate-y-[1px] hover:shadow-md",
      accent,
      column === "completed" ? "opacity-90" : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (isCancelledScheduled) {
      return (
        <div key={row.id} className={cardShell}>
          <div className="space-y-1">
            <p className="text-base font-semibold text-gray-500 line-through">
              {patientName(row)}
            </p>
            <p className="text-sm font-medium text-gray-700">
              {formatTimeEastern(row.start_time)}
            </p>
            <p className="text-xs text-gray-500">
              {clinicianLabel(row.clinician_id)}
            </p>
            <p className="text-xs text-gray-500">{serviceName(row)}</p>
          </div>
          <p className="mt-3 text-xs font-medium text-gray-500">Cancelled</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BILL_BTN_CLASS}
              onClick={() => openBillingForAppointment(row)}
            >
              + Bill
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={row.id} className={cardShell}>
        <div className="space-y-1">
          <p className="text-base font-semibold text-gray-900">
            {patientName(row)}
          </p>
          <p className="text-sm font-medium text-gray-700">
            {formatTimeEastern(row.start_time)}
          </p>
          <p className="text-xs text-gray-500">
            {clinicianLabel(row.clinician_id)}
          </p>
          <p className="text-xs text-gray-500">{serviceName(row)}</p>
        </div>
        {column === "completed" ? (
          <>
            <p className="mt-1 text-xs text-green-600">✓ Completed</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={BILL_BTN_CLASS}
                onClick={() => openBillingForAppointment(row)}
              >
                + Bill
              </button>
            </div>
          </>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {column === "scheduled" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "checked_in")}
                className="rounded-md bg-green-600/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
              >
                Check In
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "completed")}
                className="rounded-md bg-green-600/90 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
              >
                Complete
              </button>
            )}
            {canCancel ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void patchStatus(row.id, "cancelled")}
                className="text-sm text-gray-400 transition hover:text-red-500 disabled:opacity-50"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              className={BILL_BTN_CLASS}
              onClick={() => openBillingForAppointment(row)}
            >
              + Bill
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-6">
      <h1 className="mb-1 text-2xl font-semibold text-gray-900">Appointments</h1>
      <p className="mb-8 text-sm tracking-wide text-gray-500">
        Today&apos;s flow and week view
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={filterPillClass(clinicianFilter === "all")}
          onClick={() => setClinicianFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={filterPillClass(clinicianFilter === "west")}
          onClick={() => setClinicianFilter("west")}
        >
          Dr. West
        </button>
        <button
          type="button"
          className={filterPillClass(clinicianFilter === "sharpe")}
          onClick={() => setClinicianFilter("sharpe")}
        >
          Dr. Sharpe
        </button>
      </div>

      <section className="mb-8">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-gray-500">
          Patient Flow Board
        </h2>
        <div className="mt-4 rounded-2xl bg-white p-6 shadow-md">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <FlowColumn
                label="Scheduled"
                count={scheduled.length}
                emptyMessage="No appointments scheduled"
                items={scheduled.map((row) => renderCard(row, "scheduled"))}
              />
              <FlowColumn
                label="Checked In"
                count={checkedIn.length}
                emptyMessage="No patients checked in yet"
                items={checkedIn.map((row) => renderCard(row, "checked_in"))}
              />
              <FlowColumn
                label="Completed"
                count={completed.length}
                emptyMessage="No completed appointments yet"
                items={completed.map((row) => renderCard(row, "completed"))}
              />
            </div>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Week Calendar
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-7">
          {weekDays.map((ymd) => {
            const dayRows = weekAppointments
              .filter((a) => getEasternYMD(new Date(a.start_time)) === ymd)
              .sort(
                (a, b) =>
                  new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
              );
            const isToday = ymd === todayYmd;

            return (
              <div
                key={ymd}
                className={[
                  "rounded-2xl border border-gray-100 p-5 shadow-sm",
                  isToday ? "bg-emerald-50/40" : "bg-white",
                ].join(" ")}
              >
                <p className="mb-3 text-sm font-semibold text-gray-900">{dayLabel(ymd)}</p>
                <div className="space-y-2">
                  {dayRows.length === 0 ? (
                    <p className="text-xs text-gray-400">
                      No appointments scheduled
                    </p>
                  ) : (
                    dayRows.map((row) => {
                      const west = row.clinician_id === CLINICIAN_WEST_ID;
                      const sharpe = row.clinician_id === CLINICIAN_SHARPE_ID;
                      const st = row.status.toLowerCase();
                      const cancelled = st === "cancelled";
                      const checkedInBlock = st === "checked_in";
                      const completedBlock = st === "completed";
                      const fullName = patientName(row);
                      const firstNameOnly =
                        fullName.trim().split(/\s+/).filter(Boolean)[0] ??
                        fullName;
                      const cellAccent = west
                        ? "border-l-2 border-l-[#1A6B8A] bg-blue-50"
                        : sharpe
                          ? "border-l-2 border-l-[#7C3AED] bg-purple-50"
                          : "border-l-2 border-l-gray-300 bg-gray-50/60";

                      return (
                        <div
                          key={row.id}
                          title={fullName}
                          className={[
                            "overflow-hidden rounded-lg p-1.5 text-xs",
                            cellAccent,
                            cancelled ? "opacity-50" : "",
                          ].join(" ")}
                        >
                          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 gap-y-0.5">
                            <span className="shrink-0 text-xs text-gray-400">
                              {formatTimeEastern(row.start_time)}
                            </span>
                            {checkedInBlock ? (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium leading-tight text-amber-800">
                                Checked In
                              </span>
                            ) : completedBlock ? (
                              <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium leading-tight text-emerald-800">
                                ✓ Done
                              </span>
                            ) : null}
                          </div>
                          <p
                            className={`mt-0.5 min-w-0 truncate text-xs font-medium text-gray-800 ${cancelled ? "line-through" : ""}`}
                          >
                            {firstNameOnly}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {billingModalOpen && billingTarget ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => closeBillingModal()}
          role="presentation"
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal
            aria-labelledby="quick-bill-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="quick-bill-title"
              className="border-b border-gray-100 pb-4 text-lg font-semibold text-gray-900"
            >
              New Billing Record
            </h2>
            <p className="mt-3 text-sm text-gray-600">
              {billingTarget.patient_name} · {billingTarget.appointment_date}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {billingTarget.clinician}
            </p>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Billing Type
                <select
                  className={BILL_MODAL_INPUT}
                  value={billBillingType}
                  onChange={(e) => setBillBillingType(e.target.value)}
                >
                  <option value="cash">Cash</option>
                  <option value="insurance">Insurance</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>
              {(billBillingType === "insurance" || billBillingType === "mixed") ? (
                <>
                  <label className="block text-sm font-medium text-gray-700">
                    Insurance Carrier
                    <input
                      type="text"
                      className={BILL_MODAL_INPUT}
                      value={billInsurance}
                      onChange={(e) => setBillInsurance(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm font-medium text-gray-700">
                    Claim Number
                    <input
                      type="text"
                      className={BILL_MODAL_INPUT}
                      value={billClaim}
                      onChange={(e) => setBillClaim(e.target.value)}
                    />
                  </label>
                </>
              ) : null}
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
                <textarea
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-900 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  value={billNotes}
                  onChange={(e) => setBillNotes(e.target.value)}
                />
              </label>
            </div>

            <div className="mt-6 border-t border-gray-100 pt-5">
              <h3 className="text-sm font-semibold text-gray-900">CPT Codes</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                  CPT Code
                  <input
                    type="text"
                    className={BILL_MODAL_INPUT}
                    value={draftCpt}
                    onChange={(e) => setDraftCpt(e.target.value)}
                    placeholder="97140"
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                  Description
                  <input
                    type="text"
                    className={BILL_MODAL_INPUT}
                    value={draftDesc}
                    onChange={(e) => setDraftDesc(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Units
                  <input
                    type="number"
                    min={1}
                    className={BILL_MODAL_INPUT}
                    value={draftUnits}
                    onChange={(e) => setDraftUnits(e.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  Rate ($)
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={BILL_MODAL_INPUT}
                    value={draftRate}
                    onChange={(e) => setDraftRate(e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={draftTimed}
                    onChange={(e) => setDraftTimed(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-[#1F7A47] focus:ring-green-500"
                  />
                  Is Timed
                </label>
                <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                  Payment Type
                  <select
                    className={BILL_MODAL_INPUT}
                    value={draftPayType}
                    onChange={(e) => setDraftPayType(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="insurance">Insurance</option>
                  </select>
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => appendQuickBillLineItem()}
                    className="rounded-xl border border-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:text-gray-900"
                  >
                    Add
                  </button>
                </div>
              </div>

              {billLineItems.length > 0 ? (
                <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {billLineItems.map((li) => (
                    <li
                      key={li.localId}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-gray-700"
                    >
                      <span className="font-mono font-medium">{li.cpt_code}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-600">
                        {li.description || "—"}
                      </span>
                      <span>{li.units}u</span>
                      <span>${(li.rate_cents / 100).toFixed(2)}</span>
                      <button
                        type="button"
                        onClick={() => removeQuickBillLineItem(li.localId)}
                        className="ml-auto text-sm text-gray-400 transition hover:text-red-600"
                        aria-label="Remove line item"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {billModalError ? (
              <p className="mt-4 rounded-lg border border-red-100 bg-red-50/80 px-3 py-2 text-sm text-red-800">
                {billModalError}
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={() => closeBillingModal()}
                className="rounded-xl border border-gray-100 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={billSubmitBusy}
                onClick={() => void submitQuickBill()}
                className="rounded-xl bg-[#1F7A47] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {billSubmitBusy ? "Saving…" : "Create Billing Record"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toastVisible && toastMessage ? (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-xl bg-green-600 px-4 py-3 text-sm text-white shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      ) : null}
    </div>
  );
}

function FlowColumn({
  label,
  count,
  items,
  emptyMessage,
}: {
  label: string;
  count: number;
  items: React.ReactNode[];
  emptyMessage: string;
}) {
  const countLine =
    count === 1 ? "1 patient" : `${count} patients`;

  return (
    <div className="flex min-h-[400px] flex-col rounded-xl bg-gray-50/50 p-4">
      <div className="mb-4 border-b border-gray-100 pb-2">
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-sm text-gray-600">{countLine}</p>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 h-8 w-8 rounded-full bg-gray-200" />
          <p className="text-sm text-gray-500">{emptyMessage}</p>
        </div>
      ) : (
        <div className="space-y-4">{items}</div>
      )}
    </div>
  );
}

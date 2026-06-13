"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Grid3x3, LayoutList, Search } from "lucide-react";

import {
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import ClinicCard from "@/components/admin/clinics/ClinicCard";
import ClinicsListTable from "@/components/admin/clinics/ClinicsListTable";
import {
  BillingModelApi,
  ClinicEditTarget,
  EditClinicModal,
  NewClinicModal,
  buildOnboardBody,
  normalizeHexColor,
} from "@/components/admin/clinics/ClinicsModals";
import ClinicsStatCards from "@/components/admin/clinics/ClinicsStatCards";
import {
  ClinicCardData,
  ClinicsDashboardStats,
  VITALITY_CLINIC_ID,
} from "@/components/admin/clinics/clinicsTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

type ViewMode = "grid" | "list";

export default function AdminClinicsPage() {
  const router = useRouter();
  const { role, loading: clinicCtxLoading, clinicId, setClinicId } = useClinic();
  const isSuperAdmin = !clinicCtxLoading && role === "super_admin";

  const [stats, setStats] = useState<ClinicsDashboardStats | null>(null);
  const [cards, setCards] = useState<ClinicCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [billingFilter, setBillingFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const [newOpen, setNewOpen] = useState(false);
  const [newPhase, setNewPhase] = useState<"form" | "fee-schedule">("form");
  const [feeClinicId, setFeeClinicId] = useState("");
  const [feeToken, setFeeToken] = useState("");
  const [newSubmitError, setNewSubmitError] = useState<string | null>(null);
  const [newBusy, setNewBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ClinicEditTarget | null>(null);
  const [editSubmitError, setEditSubmitError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, billingFilter]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    const headers = await authHeaders();
    const params = new URLSearchParams({
      super_admin_clinic_id: clinicId,
      search: debouncedSearch,
      status: statusFilter,
      billing_model: billingFilter,
    });
    try {
      const [statsRes, cardsRes] = await Promise.all([
        fetch(`${API_BASE}/api/clinics/dashboard-stats?${params}`, { headers }),
        fetch(`${API_BASE}/api/clinics/cards?${params}`, { headers }),
      ]);
      if (statsRes.ok) setStats((await statsRes.json()) as ClinicsDashboardStats);
      if (cardsRes.ok) setCards((await cardsRes.json()) as ClinicCardData[]);
      if (!statsRes.ok && !cardsRes.ok) {
        setError("Could not load clinics dashboard.");
      }
    } catch {
      setError("Could not load clinics dashboard.");
    } finally {
      setLoading(false);
    }
  }, [clinicId, debouncedSearch, statusFilter, billingFilter]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadDashboard();
  }, [isSuperAdmin, loadDashboard]);

  useEffect(() => {
    if (!clinicCtxLoading && role !== "super_admin") {
      router.replace("/admin");
    }
  }, [clinicCtxLoading, role, router]);

  const totalPages = Math.max(1, Math.ceil(cards.length / perPage));
  const pageCards = useMemo(() => {
    const start = (page - 1) * perPage;
    return cards.slice(start, start + perPage);
  }, [cards, page, perPage]);

  const rangeStart = cards.length === 0 ? 0 : (page - 1) * perPage + 1;
  const rangeEnd = Math.min(page * perPage, cards.length);

  function openEdit(clinic: ClinicCardData) {
    setEditing({
      id: clinic.id,
      brand_name: clinic.brand_name,
      name: clinic.name,
      slug: clinic.slug ?? null,
      agent_name: clinic.agent_name,
      primary_color: clinic.primary_color,
      logo_url: clinic.logo_url,
      billing_model: clinic.billing_model,
    });
    setEditSubmitError(null);
    setEditOpen(true);
  }

  function viewDashboard(clinic: ClinicCardData) {
    setClinicId(clinic.id);
    router.push("/admin");
  }

  async function patchClinicStatus(clinic: ClinicCardData, status: "active" | "inactive") {
    if (clinic.id === VITALITY_CLINIC_ID) return;
    try {
      const res = await fetch(`${API_BASE}/clinics/${encodeURIComponent(clinic.id)}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { detail?: string };
        setError(j.detail || "Status update failed");
        return;
      }
      void loadDashboard();
    } catch {
      setError("Status update failed");
    }
  }

  async function beginFeeScheduleStep(createdId: string, email: string, password: string) {
    setFeeClinicId(createdId);
    setNewPhase("fee-schedule");
    if (email && password.length >= 8) {
      const { data, error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!signErr && data.session?.access_token) {
        setFeeToken(data.session.access_token);
        return;
      }
    }
    const { data } = await supabase.auth.getSession();
    setFeeToken(data.session?.access_token ?? "");
  }

  async function submitNew(values: {
    brand_name: string;
    slug: string;
    agent_name: string;
    primary_color: string;
    logo_url: string;
    billing_model: BillingModelApi;
    admin_email: string;
    admin_password: string;
  }) {
    setNewSubmitError(null);
    const brand = values.brand_name.trim();
    const slug = values.slug.trim().toLowerCase();
    if (!brand || !slug) {
      setNewSubmitError("Brand name and slug are required.");
      return;
    }
    if (!values.admin_email.trim() || values.admin_password.length < 8) {
      setNewSubmitError("Administrator email and password (min 8 characters) are required.");
      return;
    }
    setNewBusy(true);
    try {
      const body = buildOnboardBody(values);
      const res = await fetch(`${API_BASE}/clinics/onboard`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        detail?: string;
        clinic_id?: string;
      };
      if (!res.ok) {
        setNewSubmitError(
          typeof json.detail === "string"
            ? json.detail
            : `Could not create clinic (${res.status})`,
        );
        return;
      }
      const createdId = json.clinic_id;
      if (createdId && values.logo_url.trim()) {
        await fetch(`${API_BASE}/clinics/${encodeURIComponent(createdId)}`, {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify({ logo_url: values.logo_url.trim() }),
        });
      }
      if (createdId) {
        await beginFeeScheduleStep(
          createdId,
          values.admin_email,
          values.admin_password,
        );
      } else {
        setNewOpen(false);
        setNewPhase("form");
      }
      void loadDashboard();
    } catch {
      setNewSubmitError("Request failed.");
    } finally {
      setNewBusy(false);
    }
  }

  async function submitEdit(values: {
    brand_name: string;
    slug: string;
    agent_name: string;
    primary_color: string;
    logo_url: string;
    billing_model: BillingModelApi;
  }) {
    if (!editing?.id) return;
    setEditSubmitError(null);
    setEditBusy(true);
    try {
      const patch: Record<string, unknown> = {
        brand_name: values.brand_name.trim(),
        slug: values.slug.trim().toLowerCase(),
        agent_name: values.agent_name.trim() || "Aria",
        primary_color: normalizeHexColor(values.primary_color),
        billing_model: values.billing_model,
        logo_url: values.logo_url.trim() || null,
      };
      const res = await fetch(
        `${API_BASE}/clinics/${encodeURIComponent(editing.id)}`,
        {
          method: "PATCH",
          headers: await authHeaders(),
          body: JSON.stringify(patch),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setEditSubmitError(
          typeof json.detail === "string"
            ? json.detail
            : `Could not update clinic (${res.status})`,
        );
        return;
      }
      setEditOpen(false);
      setEditing(null);
      void loadDashboard();
    } catch {
      setEditSubmitError("Request failed.");
    } finally {
      setEditBusy(false);
    }
  }

  if (clinicCtxLoading) {
    return (
      <div className={`${DS_PAGE_ROOT} flex min-h-[40vh] items-center justify-center`}>
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className={`${DS_PAGE_ROOT} flex min-h-[30vh] items-center justify-center`}>
        <p className="text-sm text-gray-500">Redirecting…</p>
      </div>
    );
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Clinics</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Manage and monitor all clinics in your organization
          </p>
        </div>
        <button
          type="button"
          className={DS_PRIMARY_BTN}
          onClick={() => {
            setNewSubmitError(null);
            setNewPhase("form");
            setNewOpen(true);
          }}
        >
          + New Clinic
        </button>
      </div>

      <div className="mt-6">
        <ClinicsStatCards stats={stats} loading={loading} />
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clinics by name or location…"
            className={`${DS_INPUT} pl-9`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={DS_INPUT}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={billingFilter}
            onChange={(e) => setBillingFilter(e.target.value)}
            className={DS_INPUT}
          >
            <option value="all">All Billing</option>
            <option value="hybrid">Hybrid</option>
            <option value="cash">Cash</option>
            <option value="insurance">Insurance</option>
          </select>
          <div className="flex rounded-lg border border-gray-200 p-0.5">
            <button
              type="button"
              className={`rounded-md p-2 ${
                viewMode === "grid" ? "bg-gray-100 text-gray-900" : "text-gray-500"
              }`}
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`rounded-md p-2 ${
                viewMode === "list" ? "bg-gray-100 text-gray-900" : "text-gray-500"
              }`}
              onClick={() => setViewMode("list")}
              aria-label="List view"
            >
              <LayoutList className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <button type="button" className={DS_SECONDARY_BTN} onClick={() => void loadDashboard()}>
              Retry
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-96 animate-pulse rounded-xl border border-gray-200 bg-white"
              />
            ))}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid gap-4 md:grid-cols-2">
            {pageCards.map((clinic) => (
              <ClinicCard
                key={clinic.id}
                clinic={clinic}
                onEdit={openEdit}
                onDeactivate={(c) => void patchClinicStatus(c, "inactive")}
                onReactivate={(c) => void patchClinicStatus(c, "active")}
                onViewDashboard={viewDashboard}
              />
            ))}
          </div>
        ) : (
          <ClinicsListTable
            clinics={pageCards}
            onEdit={openEdit}
            onViewDashboard={viewDashboard}
          />
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Showing {rangeStart} to {rangeEnd} of {cards.length} clinics
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={perPage}
            onChange={(e) => {
              setPerPage(Number(e.target.value));
              setPage(1);
            }}
            className={DS_INPUT}
          >
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
          </select>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className={DS_SECONDARY_BTN}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      <NewClinicModal
        open={newOpen}
        busy={newBusy}
        error={newSubmitError}
        onClose={() => {
          setNewOpen(false);
          setNewPhase("form");
        }}
        onSubmit={(v) => void submitNew(v)}
        phase={newPhase}
        feeClinicId={feeClinicId}
        feeToken={feeToken}
      />

      <EditClinicModal
        open={editOpen}
        busy={editBusy}
        error={editSubmitError}
        target={editing}
        onClose={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        onSubmit={(v) => void submitEdit(v)}
      />
    </div>
  );
}

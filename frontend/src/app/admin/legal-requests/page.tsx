"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";

import {
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import LegalRequestModal, {
  type LegalRequestFormValues,
} from "@/components/admin/legal-requests/LegalRequestModal";
import LegalRequestsKanban from "@/components/admin/legal-requests/LegalRequestsKanban";
import LegalRequestsStatBar from "@/components/admin/legal-requests/LegalRequestsStatBar";
import {
  LegalRequest,
  LegalRequestStats,
  LegalRequestStatus,
  nextStatus,
  prevStatus,
} from "@/components/admin/legal-requests/legalRequestsTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export default function AdminLegalRequestsPage() {
  const { clinicId } = useClinic();
  const [requests, setRequests] = useState<LegalRequest[]>([]);
  const [stats, setStats] = useState<LegalRequestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingRequest, setEditingRequest] = useState<LegalRequest | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadStats = useCallback(async () => {
    if (!clinicId) return;
    setStatsLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/legal-requests/stats?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setStats(null);
        return;
      }
      setStats((await res.json()) as LegalRequestStats);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [clinicId]);

  const loadRequests = useCallback(async () => {
    if (!clinicId) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ clinic_id: clinicId });
      if (debouncedSearch.trim()) {
        params.set("search", debouncedSearch.trim());
      }
      const res = await fetch(
        `${API_BASE}/api/legal-requests?${params.toString()}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setError(`Could not load legal requests (HTTP ${res.status}).`);
        setRequests([]);
        return;
      }
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch {
      setError("Could not load legal requests (network error).");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, debouncedSearch]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const searchPatients = useCallback(
    async (query: string) => {
      if (!clinicId) return [];
      const params = new URLSearchParams({ clinic_id: clinicId });
      if (query.trim()) params.set("search", query.trim());
      const res = await fetch(`${API_BASE}/patients?${params.toString()}`, {
        headers: await authHeaders(),
      });
      const json = res.ok ? await res.json() : [];
      return Array.isArray(json) ? json : [];
    },
    [clinicId],
  );

  const patchStatus = useCallback(
    async (requestId: string, status: LegalRequestStatus) => {
      let previous: LegalRequest[] = [];
      setRequests((rows) => {
        previous = rows;
        return rows.map((r) => (r.id === requestId ? { ...r, status } : r));
      });
      try {
        const res = await fetch(
          `${API_BASE}/api/legal-requests/${encodeURIComponent(requestId)}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(await authHeaders()),
            },
            body: JSON.stringify({ status }),
          },
        );
        if (!res.ok) {
          setRequests(previous);
          setError(`Status update failed (HTTP ${res.status}).`);
          return;
        }
        const updated = (await res.json()) as LegalRequest;
        setRequests((rows) =>
          rows.map((r) => (r.id === requestId ? { ...r, ...updated } : r)),
        );
        void loadStats();
      } catch {
        setRequests(previous);
        setError("Status update failed (network error).");
      }
    },
    [loadStats],
  );

  function openCreate() {
    setModalMode("create");
    setEditingRequest(null);
    setModalOpen(true);
  }

  function openEdit(request: LegalRequest) {
    setModalMode("edit");
    setEditingRequest(request);
    setModalOpen(true);
  }

  async function handleCreate(values: LegalRequestFormValues) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/legal-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: values.patient_id || null,
          patient_name: values.patient_name,
          requesting_party_name: values.requesting_party_name,
          requesting_party_type: values.requesting_party_type,
          request_date: values.request_date,
          request_method: values.request_method,
          documents_requested: values.documents_requested,
          attorney_name: values.attorney_name || null,
          firm_name: values.firm_name || null,
          attorney_phone: values.attorney_phone || null,
          attorney_email: values.attorney_email || null,
          request_type: values.request_type,
          notes: values.notes || null,
        }),
      });
      if (!res.ok) {
        setError(`Create failed (HTTP ${res.status}).`);
        return;
      }
      const created = (await res.json()) as LegalRequest;
      setRequests((rows) => [created, ...rows]);
      setModalOpen(false);
      void loadStats();
    } catch {
      setError("Create failed (network error).");
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(values: LegalRequestFormValues) {
    if (!editingRequest) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/legal-requests/${encodeURIComponent(editingRequest.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(await authHeaders()),
          },
          body: JSON.stringify({
            patient_id: values.patient_id || null,
            patient_name: values.patient_name,
            requesting_party_name: values.requesting_party_name,
            requesting_party_type: values.requesting_party_type,
            request_date: values.request_date,
            request_method: values.request_method,
            documents_requested: values.documents_requested,
            documents_prepared: values.documents_prepared,
            send_date: values.send_date || null,
            send_method: values.send_method || null,
            status: values.status,
            attorney_name: values.attorney_name || null,
            firm_name: values.firm_name || null,
            attorney_phone: values.attorney_phone || null,
            attorney_email: values.attorney_email || null,
            request_type: values.request_type,
            notes: values.notes || null,
          }),
        },
      );
      if (!res.ok) {
        setError(`Save failed (HTTP ${res.status}).`);
        return;
      }
      const updated = (await res.json()) as LegalRequest;
      setRequests((rows) =>
        rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)),
      );
      setModalOpen(false);
      void loadStats();
    } catch {
      setError("Save failed (network error).");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(request: LegalRequest) {
    const previous = requests;
    setRequests((rows) => rows.filter((r) => r.id !== request.id));
    try {
      const res = await fetch(
        `${API_BASE}/api/legal-requests/${encodeURIComponent(request.id)}`,
        { method: "DELETE", headers: await authHeaders() },
      );
      if (!res.ok) {
        setRequests(previous);
        setError(`Archive failed (HTTP ${res.status}).`);
        return;
      }
      void loadStats();
    } catch {
      setRequests(previous);
      setError("Archive failed (network error).");
    }
  }

  function handleMoveForward(request: LegalRequest) {
    const next = nextStatus(request.status);
    if (!next) return;
    void patchStatus(request.id, next);
  }

  function handleMoveBack(request: LegalRequest) {
    const prev = prevStatus(request.status);
    if (!prev) return;
    void patchStatus(request.id, prev);
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>Legal Requests</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Medical record requests and attorney correspondence
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <div className="relative min-w-0 flex-1 sm:min-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient, attorney, or firm…"
              className={`${DS_INPUT} w-full pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={openCreate}
            className={`${DS_PRIMARY_BTN} inline-flex min-h-[44px] shrink-0 items-center justify-center px-4 py-2.5`}
          >
            + New Request
          </button>
        </div>
      </div>

      <div className="mt-5">
        <LegalRequestsStatBar stats={stats} loading={statsLoading} />
      </div>

      {error ? (
        <p className="mt-6 rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="py-16 text-center text-sm text-gray-500">Loading board…</p>
        ) : (
          <LegalRequestsKanban
            requests={requests}
            onEdit={openEdit}
            onMove={(id, status) => void patchStatus(id, status)}
            onMoveForward={handleMoveForward}
            onMoveBack={handleMoveBack}
            onArchive={(r) => void handleArchive(r)}
          />
        )}
      </div>

      <LegalRequestModal
        open={modalOpen}
        mode={modalMode}
        initial={editingRequest}
        clinicId={clinicId}
        saving={saving}
        onClose={() => setModalOpen(false)}
        onSubmit={(values) =>
          void (modalMode === "create" ? handleCreate(values) : handleEdit(values))
        }
        searchPatients={searchPatients}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";

import {
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import PiCaseModal, { type PiCaseFormValues } from "@/components/admin/pi-cases/PiCaseModal";
import PiCasesActivityFeed from "@/components/admin/pi-cases/PiCasesActivityFeed";
import PiCasesAllCasesTable from "@/components/admin/pi-cases/PiCasesAllCasesTable";
import PiCasesDonutChart from "@/components/admin/pi-cases/PiCasesDonutChart";
import PiCasesKanban from "@/components/admin/pi-cases/PiCasesKanban";
import PiCasesSidePanels from "@/components/admin/pi-cases/PiCasesSidePanels";
import PiCasesStatCards from "@/components/admin/pi-cases/PiCasesStatCards";
import {
  KANBAN_COLUMNS,
  PiCaseActivity,
  PiCaseBoard,
  PiCaseBoardItem,
  PiCaseDeadline,
  PiCaseStats,
  PiCaseStatus,
  PiCaseTopAttorney,
  nextStatus,
  prevStatus,
} from "@/components/admin/pi-cases/piCasesTypes";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

type ViewTab = "board" | "all" | "attorney" | "documents" | "settlements";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function emptyBoard(): PiCaseBoard {
  return {
    intake_open: [],
    treatment: [],
    records_requested: [],
    settlement_negotiation: [],
    closed_settled: [],
  };
}

function parseNum(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function AdminPiCasesPage() {
  const { clinicId } = useClinic();
  const [viewTab, setViewTab] = useState<ViewTab>("board");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stats, setStats] = useState<PiCaseStats | null>(null);
  const [board, setBoard] = useState<PiCaseBoard | null>(null);
  const [allCases, setAllCases] = useState<PiCaseBoardItem[]>([]);
  const [activity, setActivity] = useState<PiCaseActivity[]>([]);
  const [deadlines, setDeadlines] = useState<PiCaseDeadline[]>([]);
  const [attorneys, setAttorneys] = useState<PiCaseTopAttorney[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingCase, setEditingCase] = useState<PiCaseBoardItem | null>(null);
  const [defaultStatus, setDefaultStatus] = useState<PiCaseStatus>("intake_open");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadDashboard = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const h = await authHeaders();
      const base = `${API_BASE}/api/pi-cases`;
      const params = new URLSearchParams({ clinic_id: clinicId });
      const listParams = new URLSearchParams({ clinic_id: clinicId });
      if (debouncedSearch.trim()) listParams.set("search", debouncedSearch.trim());

      const [statsRes, boardRes, listRes, actRes, deadRes, attyRes] = await Promise.all([
        fetch(`${base}/stats?${params}`, { headers: h }),
        fetch(`${base}/board?${params}`, { headers: h }),
        fetch(`${base}?${listParams}`, { headers: h }),
        fetch(`${base}/activity?${params}&limit=10`, { headers: h }),
        fetch(`${base}/deadlines?${params}&limit=6`, { headers: h }),
        fetch(`${base}/top-attorneys?${params}&limit=5`, { headers: h }),
      ]);

      setStats(statsRes.ok ? await statsRes.json() : null);
      setBoard(boardRes.ok ? await boardRes.json() : emptyBoard());
      setAllCases(listRes.ok ? await listRes.json() : []);
      setActivity(actRes.ok ? await actRes.json() : []);
      setDeadlines(deadRes.ok ? await deadRes.json() : []);
      setAttorneys(attyRes.ok ? await attyRes.json() : []);
    } catch {
      setError("Could not load PI cases dashboard.");
    } finally {
      setLoading(false);
    }
  }, [clinicId, debouncedSearch]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const searchPatients = useCallback(
    async (query: string) => {
      const params = new URLSearchParams({ clinic_id: clinicId });
      if (query.trim()) params.set("search", query.trim());
      const res = await fetch(`${API_BASE}/patients?${params}`, {
        headers: await authHeaders(),
      });
      const json = res.ok ? await res.json() : [];
      return Array.isArray(json) ? json : [];
    },
    [clinicId],
  );

  const patchStatus = useCallback(
    async (caseId: string, status: PiCaseStatus) => {
      let previous = board;
      setBoard((b) => {
        if (!b) return b;
        previous = b;
        const next = emptyBoard();
        let moved: PiCaseBoardItem | null = null;
        for (const col of KANBAN_COLUMNS) {
          for (const item of b[col.id] ?? []) {
            if (item.id === caseId) {
              moved = { ...item, status };
            } else {
              next[col.id].push(item);
            }
          }
        }
        if (moved) next[status].push(moved);
        return next;
      });
      try {
        const res = await fetch(`${API_BASE}/api/pi-cases/${encodeURIComponent(caseId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) {
          setBoard(previous);
          setError("Status update failed.");
          return;
        }
        void loadDashboard();
      } catch {
        setBoard(previous);
        setError("Status update failed.");
      }
    },
    [board, loadDashboard],
  );

  function openCreate(status: PiCaseStatus = "intake_open") {
    setModalMode("create");
    setEditingCase(null);
    setDefaultStatus(status);
    setModalOpen(true);
  }

  function openEdit(item: PiCaseBoardItem) {
    setModalMode("edit");
    setEditingCase(item);
    setModalOpen(true);
  }

  async function handleCreate(values: PiCaseFormValues) {
    if (!values.patient_id) {
      setError("Select a patient.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/pi-cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: values.patient_id,
          insurance_carrier: values.insurance_carrier,
          status: values.status,
          date_of_accident: values.date_of_accident || null,
          claim_number: values.claim_number || null,
          attorney_name: values.attorney_name || null,
          firm_name: values.firm_name || null,
          attorney_phone: values.attorney_phone || null,
          attorney_email: values.attorney_email || null,
          estimated_settlement: parseNum(values.estimated_settlement),
          notes: values.notes || null,
        }),
      });
      if (!res.ok) {
        setError(await res.text().catch(() => "Create failed"));
        return;
      }
      setModalOpen(false);
      void loadDashboard();
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(values: PiCaseFormValues) {
    if (!editingCase) return;
    setSaving(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/pi-cases/${encodeURIComponent(editingCase.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({
            insurance_carrier: values.insurance_carrier,
            claim_number: values.claim_number || null,
            date_of_accident: values.date_of_accident || null,
            attorney_name: values.attorney_name || null,
            firm_name: values.firm_name || null,
            attorney_phone: values.attorney_phone || null,
            attorney_email: values.attorney_email || null,
            estimated_settlement: parseNum(values.estimated_settlement),
            demand_amount: parseNum(values.demand_amount),
            settled_amount: parseNum(values.settled_amount),
            records_requested_date: values.records_requested_date || null,
            records_due_date: values.records_due_date || null,
            hearing_date: values.hearing_date || null,
            settlement_date: values.settlement_date || null,
            status: values.status,
            case_tags: values.case_tags,
            notes: values.notes || null,
          }),
        },
      );
      if (!res.ok) {
        setError(await res.text().catch(() => "Save failed"));
        return;
      }
      setModalOpen(false);
      void loadDashboard();
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(item: PiCaseBoardItem) {
    await patchStatus(item.id, "closed_settled");
  }

  const filteredCases = useMemo(() => {
    if (viewTab === "attorney") {
      return allCases.filter((c) => c.attorney_request_pending);
    }
    if (viewTab === "settlements") {
      return allCases.filter(
        (c) =>
          c.status === "settlement_negotiation" || c.status === "closed_settled",
      );
    }
    return allCases;
  }, [allCases, viewTab]);

  const tabs: { id: ViewTab; label: string }[] = [
    { id: "board", label: "Board" },
    { id: "all", label: "All Cases" },
    { id: "attorney", label: "Attorney Requests" },
    { id: "documents", label: "Documents" },
    { id: "settlements", label: "Settlements" },
  ];

  return (
    <div className={DS_PAGE_ROOT}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className={DS_PAGE_TITLE}>PI Cases</h1>
          <p className={DS_PAGE_SUBTITLE}>
            Manage personal injury cases from intake to settlement
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={DS_SECONDARY_BTN}>
            Reports
          </button>
          <button type="button" className={DS_PRIMARY_BTN} onClick={() => openCreate()}>
            + New PI Case
          </button>
        </div>
      </div>

      <div className="mt-6">
        <PiCasesStatCards stats={stats} loading={loading} />
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setViewTab(t.id)}
              className={
                viewTab === t.id
                  ? "rounded-full bg-[#16A34A] px-4 py-1.5 text-sm font-medium text-white"
                  : "rounded-full border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cases…"
              className={`${DS_INPUT} pl-9`}
            />
          </div>
          <button type="button" className={DS_SECONDARY_BTN}>
            <Filter className="mr-1 inline h-4 w-4" />
            Filters
          </button>
          <button type="button" className={DS_SECONDARY_BTN}>
            Sort
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {viewTab === "board" ? (
        <>
          <div className="mt-6 flex flex-col gap-6 xl:flex-row xl:items-start">
            <div className="min-w-0 flex-1 xl:w-3/4">
              <PiCasesKanban
                board={board}
                onEdit={openEdit}
                onMove={(id, status) => void patchStatus(id, status)}
                onMoveForward={(item) => {
                  const n = nextStatus(item.status);
                  if (n) void patchStatus(item.id, n);
                }}
                onMoveBack={(item) => {
                  const p = prevStatus(item.status);
                  if (p) void patchStatus(item.id, p);
                }}
                onArchive={(item) => void handleArchive(item)}
                onAddCase={openCreate}
              />
            </div>
            <div className="w-full shrink-0 xl:w-1/4">
              <PiCasesSidePanels
                deadlines={deadlines}
                attorneys={attorneys}
                loading={loading}
              />
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <PiCasesActivityFeed items={activity} loading={loading} />
            </div>
            <div className="lg:col-span-2">
              <PiCasesDonutChart stats={stats} loading={loading} />
            </div>
          </div>
        </>
      ) : viewTab === "documents" ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Documents view — link records requests and uploads here.
        </div>
      ) : (
        <div className="mt-6">
          <PiCasesAllCasesTable
            cases={filteredCases}
            loading={loading}
            onEdit={openEdit}
          />
        </div>
      )}

      <PiCaseModal
        open={modalOpen}
        mode={modalMode}
        initial={editingCase}
        defaultStatus={defaultStatus}
        clinicId={clinicId}
        saving={saving}
        onClose={() => setModalOpen(false)}
        onSubmit={(v) => void (modalMode === "create" ? handleCreate(v) : handleEdit(v))}
        searchPatients={searchPatients}
      />
    </div>
  );
}

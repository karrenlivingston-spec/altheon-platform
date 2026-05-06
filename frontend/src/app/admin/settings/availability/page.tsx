"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import { useClinic } from "@/app/admin/ClinicContext";
import { supabase } from "@/lib/supabase";

const API_BASE = "https://altheon-platform.onrender.com";

type Clinician = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
};

type Rule = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  is_active: boolean;
};

type Blocked = {
  id: string;
  start_time: string;
  end_time: string;
  reason?: string | null;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function defaultRules(): Rule[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day_of_week: day,
    start_time: "09:00",
    end_time: "17:00",
    slot_duration_minutes: 60,
    buffer_minutes: 10,
    is_active: false,
  }));
}

function formatClinician(c: Clinician): string {
  const full = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
  return full || c.id;
}

function toHm(v: string): string {
  const t = String(v || "").slice(0, 5);
  return /^\d{2}:\d{2}$/.test(t) ? t : "09:00";
}

function to12h(hm: string): string {
  const [hRaw, mRaw] = hm.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hm;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const same = s.toDateString() === e.toDateString();
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (same) return fmt.format(s);
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(s)}–${fmt.format(e)}`;
}

export default function AvailabilitySettingsPage() {
  const { clinicId } = useClinic();
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [selectedClinicianId, setSelectedClinicianId] = useState("");
  const [rules, setRules] = useState<Rule[]>(defaultRules());
  const [blocked, setBlocked] = useState<Blocked[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [startDate, setStartDate] = useState(toYmd(new Date()));
  const [endDate, setEndDate] = useState(toYmd(new Date()));
  const [reason, setReason] = useState("");
  const [busyDelete, setBusyDelete] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");

  async function headers(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    const out: Record<string, string> = { "Content-Type": "application/json" };
    if (token) out.Authorization = `Bearer ${token}`;
    return out;
  }

  async function loadClinicians() {
    const res = await fetch(
      `${API_BASE}/clinicians?clinic_id=${encodeURIComponent(clinicId)}`,
      { headers: await headers() },
    );
    const data = (res.ok ? await res.json() : []) as Clinician[];
    setClinicians(Array.isArray(data) ? data : []);
    if ((Array.isArray(data) ? data : []).length > 0) {
      setSelectedClinicianId(data[0].id);
    }
  }

  async function fetchAvailability(cid: string) {
    console.log("Fetching availability for:", cid);
    const [rulesRes, blockRes] = await Promise.all([
      fetch(`${API_BASE}/clinicians/${encodeURIComponent(cid)}/availability`, {
        headers: await headers(),
      }),
      fetch(
        `${API_BASE}/clinicians/${encodeURIComponent(cid)}/blocked-time?from_date=${encodeURIComponent(toYmd(new Date()))}`,
        { headers: await headers() },
      ),
    ]);
    const rulesData = (rulesRes.ok ? await rulesRes.json() : []) as Rule[];
    console.log("Availability response:", rulesData);
    const blockData = (blockRes.ok ? await blockRes.json() : []) as Blocked[];
    const next: Rule[] = [0, 1, 2, 3, 4, 5, 6].map((dayNum) => {
      const rule = (rulesData || []).find((r) => Number(r.day_of_week) === dayNum);
      return {
        day_of_week: dayNum,
        is_active: rule ? Boolean(rule.is_active) : false,
        start_time: rule ? String(rule.start_time || "").slice(0, 5) : "09:00",
        end_time: rule ? String(rule.end_time || "").slice(0, 5) : "17:00",
        slot_duration_minutes: rule ? Number(rule.slot_duration_minutes || 60) : 60,
        buffer_minutes: rule ? Number(rule.buffer_minutes || 10) : 10,
      };
    });
    setRules(next);
    setBlocked(Array.isArray(blockData) ? blockData : []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setInitialLoading(true);
      await loadClinicians();
      if (!cancelled) setInitialLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  useEffect(() => {
    if (!selectedClinicianId) return;
    let cancelled = false;
    (async () => {
      setRefreshing(true);
      await fetchAvailability(selectedClinicianId);
      if (!cancelled) setRefreshing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedClinicianId]);

  const rows = useMemo(() => [...rules].sort((a, b) => a.day_of_week - b.day_of_week), [rules]);

  async function saveSchedule() {
    if (!selectedClinicianId) return;
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`${API_BASE}/clinicians/${encodeURIComponent(selectedClinicianId)}/availability`, {
        method: "PUT",
        headers: await headers(),
        body: JSON.stringify(rows),
      });
      if (res.ok) {
        setMsg("Schedule saved.");
      } else {
        setMsg(`Failed to save (${res.status})`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function addBlock() {
    if (!selectedClinicianId) return;
    const body = {
      start_time: `${startDate}T00:00:00`,
      end_time: `${endDate}T23:59:59`,
      reason,
    };
    const res = await fetch(`${API_BASE}/clinicians/${encodeURIComponent(selectedClinicianId)}/blocked-time`, {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMsg(`Failed to add block (${res.status})`);
      return;
    }
    setShowAddBlock(false);
    setReason("");
    await fetchAvailability(selectedClinicianId);
  }

  async function removeBlock(id: string) {
    setBusyDelete((p) => ({ ...p, [id]: true }));
    try {
      await fetch(`${API_BASE}/blocked-time/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: await headers(),
      });
      await fetchAvailability(selectedClinicianId);
    } finally {
      setBusyDelete((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  }

  if (initialLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading availability…</div>;
  }

  return (
    <div className={DS_PAGE_ROOT}>
      <h1 className={DS_PAGE_TITLE}>Provider Availability</h1>
      <p className={DS_PAGE_SUBTITLE}>Manage clinician schedules and blocked time</p>

      <section className={`${DS_CARD} mt-6`}>
        <label className="text-xs font-medium uppercase tracking-[0.05em] text-gray-500">
          Provider
        </label>
        <select
          className={`mt-2 h-10 max-w-sm ${DS_INPUT}`}
          value={selectedClinicianId}
          onChange={(e) => setSelectedClinicianId(e.target.value)}
        >
          {clinicians.map((c) => (
            <option key={c.id} value={c.id}>
              {formatClinician(c)}
            </option>
          ))}
        </select>
        {refreshing ? (
          <p className="mt-2 text-xs text-slate-500">Loading provider availability…</p>
        ) : null}
      </section>

      <section className={`${DS_CARD} mt-6`}>
        <h2 className="text-lg font-semibold text-slate-900">Working Hours</h2>
        <div className="mt-4 grid grid-cols-6 gap-2 text-xs font-medium uppercase tracking-[0.05em] text-slate-500">
          <span>On</span><span>Day</span><span>Start</span><span>End</span><span>Session</span><span>Buffer</span>
        </div>
        <div className="mt-2 space-y-2">
          {rows.map((r) => {
            const inactive = !r.is_active;
            return (
              <div
                key={r.day_of_week}
                className={`grid grid-cols-6 items-center gap-2 rounded-xl border border-black/10 bg-white p-3 ${inactive ? "opacity-45" : ""}`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-[#16A34A] focus:ring-green-500"
                  checked={r.is_active}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((x) =>
                        x.day_of_week === r.day_of_week ? { ...x, is_active: e.target.checked } : x,
                      ),
                    )
                  }
                />
                <span className="text-sm font-medium text-slate-800">{DAYS[r.day_of_week]}</span>
                <input
                  type="time"
                  disabled={!r.is_active}
                  className={`h-9 ${DS_INPUT}`}
                  value={r.start_time}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((x) =>
                        x.day_of_week === r.day_of_week ? { ...x, start_time: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  type="time"
                  disabled={!r.is_active}
                  className={`h-9 ${DS_INPUT}`}
                  value={r.end_time}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((x) =>
                        x.day_of_week === r.day_of_week ? { ...x, end_time: e.target.value } : x,
                      ),
                    )
                  }
                />
                <select
                  disabled={!r.is_active}
                  className={`h-9 ${DS_INPUT}`}
                  value={r.slot_duration_minutes}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((x) =>
                        x.day_of_week === r.day_of_week
                          ? { ...x, slot_duration_minutes: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                >
                  {[30, 45, 60, 90].map((v) => (
                    <option key={v} value={v}>{v} min</option>
                  ))}
                </select>
                <select
                  disabled={!r.is_active}
                  className={`h-9 ${DS_INPUT}`}
                  value={r.buffer_minutes}
                  onChange={(e) =>
                    setRules((prev) =>
                      prev.map((x) =>
                        x.day_of_week === r.day_of_week
                          ? { ...x, buffer_minutes: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                >
                  {[0, 5, 10, 15, 20].map((v) => (
                    <option key={v} value={v}>{v} min</option>
                  ))}
                </select>
                <div className="col-span-6 -mt-1 text-[11px] text-slate-400">
                  {to12h(r.start_time)} - {to12h(r.end_time)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveSchedule()}
            className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
          >
            {saving ? "Saving…" : "Save Schedule"}
          </button>
          {msg ? <span className="text-sm text-green-600">{msg}</span> : null}
        </div>
      </section>

      <section className={`${DS_CARD} mt-6`}>
        <h2 className="text-lg font-semibold text-slate-900">Blocked Time</h2>
        <p className="mt-1 text-sm text-slate-500">
          Block off holidays, sick days, or any time the provider is unavailable.
        </p>
        {!showAddBlock ? (
          <button
            type="button"
            onClick={() => setShowAddBlock(true)}
            className="mt-4 rounded-lg border-[1.5px] border-[#16A34A] px-4 py-2 text-sm font-medium text-[#16A34A] hover:bg-[#f0fdf4]"
          >
            Add Block
          </button>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-black/10 bg-slate-50 p-4 md:grid-cols-4">
            <input type="date" className={`h-9 ${DS_INPUT}`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <input type="date" className={`h-9 ${DS_INPUT}`} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <input
              type="text"
              className={`h-9 ${DS_INPUT}`}
              placeholder="e.g. Holiday, Conference, Sick Day"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void addBlock()} className={DS_PRIMARY_BTN}>
                Add Block
              </button>
              <button type="button" onClick={() => setShowAddBlock(false)} className={DS_SECONDARY_BTN}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {blocked.length === 0 ? (
            <p className="text-sm text-slate-500">No blocked time scheduled</p>
          ) : (
            blocked.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-xl border border-black/10 bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{fmtRange(b.start_time, b.end_time)}</p>
                  <p className="text-xs text-slate-500">{b.reason || "Unavailable"}</p>
                </div>
                <button
                  type="button"
                  disabled={!!busyDelete[b.id]}
                  onClick={() => void removeBlock(b.id)}
                  className="rounded-lg border border-[#DC2626]/30 px-3 py-1.5 text-sm font-medium text-[#DC2626] hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}


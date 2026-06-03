"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

import {
  DS_CARD,
  DS_INPUT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const TEAL = "var(--color-primary, #0D9488)";
const LABEL_CLASS =
  "block text-xs font-medium uppercase tracking-wide text-gray-500";

type FeeScheduleRow = {
  id: string;
  cpt_code: string;
  description?: string | null;
  category?: string | null;
  charge: number;
  modifiers: string[];
  is_active: boolean;
};

type CptCodeOption = {
  id?: string;
  code: string;
  description: string;
  category?: string | null;
  default_units?: number;
};

type ModifierRule = {
  modifier_code: string;
  description?: string;
};

type ParsedImportRow = {
  cpt_code: string;
  charge: number;
  modifiers: string[];
  description?: string;
};

function InlineSectionError({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
      {message}
    </p>
  );
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseModifiersRaw(raw: unknown): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split(/[;,]/)
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
}

function parseCharge(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseSpreadsheetRow(row: Record<string, unknown>): ParsedImportRow | null {
  const map: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    map[normalizeKey(k)] = v;
  }
  const code = String(
    map.cpt_code ?? map.code ?? map.cpt ?? "",
  )
    .trim()
    .toUpperCase();
  const charge = parseCharge(map.charge ?? map.price ?? map.amount);
  if (!code || charge == null) return null;
  const modifiers = parseModifiersRaw(map.modifiers ?? map.modifier);
  const description = String(map.description ?? "").trim() || undefined;
  return { cpt_code: code, charge, modifiers, description };
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function downloadCsvTemplate() {
  const lines = [
    "CPT Code,Description,Charge,Modifiers",
    "97110,Therapeutic exercises,150.00,GP",
    "97140,Manual therapy,125.00,GP;59",
    "20560,Dry needling 1-2 muscles,175.00,",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "fee-schedule-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export type FeeScheduleManagerProps = {
  clinicId: string;
  token: string;
  readOnly?: boolean;
};

export function FeeScheduleManager({
  clinicId,
  token,
  readOnly = false,
}: FeeScheduleManagerProps) {
  const [rows, setRows] = useState<FeeScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [previewRows, setPreviewRows] = useState<ParsedImportRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [modifierRules, setModifierRules] = useState<ModifierRule[]>([]);
  const [editingChargeId, setEditingChargeId] = useState<string | null>(null);
  const [chargeDraft, setChargeDraft] = useState("");
  const [modifierMenuId, setModifierMenuId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [cptSearch, setCptSearch] = useState("");
  const [cptOptions, setCptOptions] = useState<CptCodeOption[]>([]);
  const [cptSearchBusy, setCptSearchBusy] = useState(false);
  const [selectedCpt, setSelectedCpt] = useState<CptCodeOption | null>(null);
  const [addCharge, setAddCharge] = useState("");
  const [addModifiers, setAddModifiers] = useState<string[]>([]);
  const [addBusy, setAddBusy] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const authHeaders = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const loadSchedule = useCallback(async () => {
    if (!clinicId.trim() || !token.trim()) {
      setRows([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/fee-schedule?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        setLoadError(
          (await res.text().catch(() => "")).trim() ||
            `Could not load fee schedule (${res.status})`,
        );
        setRows([]);
        return;
      }
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setRows(
        list.map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ""),
          cpt_code: String(r.cpt_code ?? ""),
          description: r.description as string | null | undefined,
          category: r.category as string | null | undefined,
          charge: Number(r.charge) || 0,
          modifiers: Array.isArray(r.modifiers)
            ? (r.modifiers as string[]).map((m) => String(m).toUpperCase())
            : [],
          is_active: r.is_active !== false,
        })),
      );
    } catch {
      setLoadError("Could not load fee schedule.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clinicId, token, authHeaders]);

  const loadModifierRules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/modifier-rules`);
      if (!res.ok) return;
      const data = await res.json();
      setModifierRules(Array.isArray(data) ? (data as ModifierRule[]) : []);
    } catch {
      setModifierRules([]);
    }
  }, []);

  useEffect(() => {
    void loadSchedule();
    void loadModifierRules();
  }, [loadSchedule, loadModifierRules]);

  const groupedRows = useMemo(() => {
    const map = new Map<string, FeeScheduleRow[]>();
    for (const row of rows) {
      const cat = (row.category ?? "").trim() || "Uncategorized";
      const list = map.get(cat) ?? [];
      list.push(row);
      map.set(cat, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  function flashSuccess(msg: string) {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(null), 4000);
  }

  async function patchRow(
    id: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    setRowBusyId(id);
    setSectionError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/fee-schedule/${encodeURIComponent(id)}?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setSectionError(
          (await res.text().catch(() => "")).trim() || "Update failed",
        );
        return false;
      }
      await loadSchedule();
      return true;
    } catch {
      setSectionError("Update failed.");
      return false;
    } finally {
      setRowBusyId(null);
    }
  }

  async function deleteRow(id: string) {
    if (readOnly) return;
    if (!window.confirm("Remove this code from the active fee schedule?")) return;
    setRowBusyId(id);
    setSectionError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/fee-schedule/${encodeURIComponent(id)}?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: "DELETE", headers: authHeaders() },
      );
      if (!res.ok) {
        setSectionError(
          (await res.text().catch(() => "")).trim() || "Delete failed",
        );
        return;
      }
      await loadSchedule();
    } catch {
      setSectionError("Delete failed.");
    } finally {
      setRowBusyId(null);
    }
  }

  function handleFileSelect(file: File | null) {
    setParseError(null);
    setPreviewRows([]);
    setImportErrors([]);
    if (!file) return;

    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsed: ParsedImportRow[] = [];
          for (const row of results.data) {
            const p = parseSpreadsheetRow(row);
            if (p) parsed.push(p);
          }
          if (!parsed.length) {
            setParseError("No valid rows found in CSV.");
            return;
          }
          setPreviewRows(parsed);
        },
        error: (err) => setParseError(err.message || "CSV parse failed"),
      });
      return;
    }

    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            setParseError("Could not read file.");
            return;
          }
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
          const parsed: ParsedImportRow[] = [];
          for (const row of json) {
            const p = parseSpreadsheetRow(row);
            if (p) parsed.push(p);
          }
          if (!parsed.length) {
            setParseError("No valid rows found in spreadsheet.");
            return;
          }
          setPreviewRows(parsed);
        } catch {
          setParseError("Could not parse Excel file.");
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    setParseError("Please upload a .csv or .xlsx file.");
  }

  async function runBulkImport() {
    if (readOnly || !previewRows.length) return;
    setImportBusy(true);
    setImportErrors([]);
    setSectionError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/fee-schedule/bulk?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            items: previewRows.map((r) => ({
              cpt_code: r.cpt_code,
              charge: r.charge,
              modifiers: r.modifiers,
            })),
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        saved?: number;
        errors?: string[];
        detail?: string;
      };
      if (!res.ok) {
        setSectionError(json.detail || `Import failed (${res.status})`);
        return;
      }
      const errs = Array.isArray(json.errors) ? json.errors : [];
      setImportErrors(errs);
      const saved = Number(json.saved) || 0;
      if (saved > 0) {
        flashSuccess(`${saved} codes imported successfully`);
        setPreviewRows([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        await loadSchedule();
      }
      if (saved === 0 && errs.length) {
        setSectionError("Import completed with errors.");
      }
    } catch {
      setSectionError("Import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  async function saveChargeEdit(row: FeeScheduleRow) {
    const n = parseCharge(chargeDraft);
    if (n == null) {
      setEditingChargeId(null);
      return;
    }
    if (n === row.charge) {
      setEditingChargeId(null);
      return;
    }
    const ok = await patchRow(row.id, { charge: n });
    if (ok) setEditingChargeId(null);
  }

  function toggleModifier(row: FeeScheduleRow, code: string) {
    const set = new Set(row.modifiers);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    void patchRow(row.id, { modifiers: [...set] });
    setModifierMenuId(null);
  }

  useEffect(() => {
    if (!addOpen) return;
    const q = cptSearch.trim();
    const timer = window.setTimeout(async () => {
      setCptSearchBusy(true);
      try {
        const params = new URLSearchParams();
        if (q) params.set("search", q);
        const res = await fetch(`${API_BASE}/api/cpt-codes?${params.toString()}`);
        if (!res.ok) {
          setCptOptions([]);
          return;
        }
        const data = await res.json();
        setCptOptions(Array.isArray(data) ? (data as CptCodeOption[]) : []);
      } catch {
        setCptOptions([]);
      } finally {
        setCptSearchBusy(false);
      }
    }, 280);
    return () => window.clearTimeout(timer);
  }, [addOpen, cptSearch]);

  async function submitAddCode() {
    if (!selectedCpt) {
      setSectionError("Select a CPT code.");
      return;
    }
    const charge = parseCharge(addCharge);
    if (charge == null) {
      setSectionError("Enter a valid charge amount.");
      return;
    }
    setAddBusy(true);
    setSectionError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/fee-schedule?clinic_id=${encodeURIComponent(clinicId)}`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            cpt_code: selectedCpt.code,
            charge,
            modifiers: addModifiers,
          }),
        },
      );
      if (!res.ok) {
        setSectionError(
          (await res.text().catch(() => "")).trim() || "Could not add code",
        );
        return;
      }
      setAddOpen(false);
      setSelectedCpt(null);
      setCptSearch("");
      setAddCharge("");
      setAddModifiers([]);
      await loadSchedule();
      flashSuccess("Code added to fee schedule");
    } catch {
      setSectionError("Could not add code.");
    } finally {
      setAddBusy(false);
    }
  }

  if (!token.trim()) {
    return (
      <InlineSectionError message="Sign in is required to manage the fee schedule." />
    );
  }

  return (
    <div className="space-y-8">
      {sectionError ? <InlineSectionError message={sectionError} /> : null}
      {successMsg ? (
        <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {successMsg}
        </p>
      ) : null}

      {!readOnly ? (
        <section className={DS_CARD}>
          <h3 className="text-lg font-semibold text-gray-900">
            Upload Fee Schedule
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Upload a CSV or Excel file with columns: CPT Code, Charge, Modifiers
            (optional)
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="block text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#f0fdf4] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[#0D9488]"
              onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={downloadCsvTemplate}
              className={DS_SECONDARY_BTN}
              style={{ borderColor: TEAL, color: TEAL }}
            >
              Download Template
            </button>
          </div>
          {parseError ? (
            <p className="mt-3 text-sm text-amber-800">{parseError}</p>
          ) : null}
          {previewRows.length > 0 ? (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-gray-700">
                Preview ({previewRows.length} rows)
              </p>
              <div className={`${DS_TABLE_WRAP} max-h-64 overflow-y-auto`}>
                <table className="min-w-full text-left text-sm">
                  <thead className={DS_TABLE_HEAD}>
                    <tr>
                      <th className={DS_TH}>CPT</th>
                      <th className={DS_TH}>Charge</th>
                      <th className={DS_TH}>Modifiers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r, i) => (
                      <tr key={`${r.cpt_code}-${i}`} className={DS_TR}>
                        <td className={DS_TD_PRIMARY}>{r.cpt_code}</td>
                        <td className={DS_TD_PRIMARY}>
                          {formatMoney(r.charge)}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          {r.modifiers.join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={importBusy}
                onClick={() => void runBulkImport()}
                className={`${DS_PRIMARY_BTN} mt-4 disabled:opacity-50`}
                style={{ backgroundColor: TEAL }}
              >
                {importBusy
                  ? "Importing…"
                  : `Import ${previewRows.length} rows`}
              </button>
              {importErrors.length > 0 ? (
                <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-amber-800">
                  {importErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={DS_CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-900">Fee Schedule</h3>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => {
                setAddOpen(true);
                setSectionError(null);
              }}
              className={DS_PRIMARY_BTN}
              style={{ backgroundColor: TEAL }}
            >
              + Add Code
            </button>
          ) : null}
        </div>

        {loadError ? <InlineSectionError message={loadError} /> : null}

        {loading ? (
          <p className="text-sm text-gray-500">Loading fee schedule…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">
            No fee schedule configured. Upload a spreadsheet or add codes
            manually.
          </p>
        ) : (
          <div className={DS_TABLE_WRAP}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className={DS_TABLE_HEAD}>
                  <tr>
                    <th className={DS_TH}>CPT Code</th>
                    <th className={DS_TH}>Description</th>
                    <th className={DS_TH}>Charge</th>
                    <th className={DS_TH}>Modifiers</th>
                    <th className={DS_TH}>Active</th>
                    {!readOnly ? <th className={DS_TH}>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map(([category, catRows]) => (
                    <Fragment key={`cat-${category}`}>
                      <tr className="bg-gray-50/80">
                        <td
                          colSpan={readOnly ? 6 : 7}
                          className="px-6 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600"
                        >
                          {category}
                        </td>
                      </tr>
                      {catRows.map((row) => (
                        <tr key={row.id} className={DS_TR}>
                          <td className={`${DS_TD_PRIMARY} font-mono font-medium`}>
                            {row.cpt_code}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {row.description ?? "—"}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            {readOnly ? (
                              formatMoney(row.charge)
                            ) : editingChargeId === row.id ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className={`w-28 ${DS_INPUT}`}
                                value={chargeDraft}
                                autoFocus
                                disabled={rowBusyId === row.id}
                                onChange={(e) => setChargeDraft(e.target.value)}
                                onBlur={() => void saveChargeEdit(row)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void saveChargeEdit(row);
                                  }
                                  if (e.key === "Escape") {
                                    setEditingChargeId(null);
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="rounded px-1 text-left font-medium tabular-nums hover:bg-gray-100"
                                style={{ color: TEAL }}
                                disabled={rowBusyId === row.id}
                                onClick={() => {
                                  setEditingChargeId(row.id);
                                  setChargeDraft(String(row.charge));
                                }}
                              >
                                {formatMoney(row.charge)}
                              </button>
                            )}
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <div className="relative flex flex-wrap items-center gap-1">
                              {row.modifiers.map((m) => (
                                <span
                                  key={m}
                                  className="inline-flex rounded-full border border-[#99f6e4] bg-[#f0fdfa] px-2 py-0.5 text-xs font-medium text-[#0f766e]"
                                >
                                  {m}
                                </span>
                              ))}
                              {!readOnly ? (
                                <button
                                  type="button"
                                  className="rounded border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:border-[#0D9488] hover:text-[#0D9488]"
                                  disabled={rowBusyId === row.id}
                                  onClick={() =>
                                    setModifierMenuId(
                                      modifierMenuId === row.id ? null : row.id,
                                    )
                                  }
                                >
                                  {row.modifiers.length ? "Edit" : "+ Mod"}
                                </button>
                              ) : null}
                              {modifierMenuId === row.id ? (
                                <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                                  {modifierRules.map((rule) => {
                                    const code = rule.modifier_code;
                                    const checked = row.modifiers.includes(code);
                                    return (
                                      <label
                                        key={code}
                                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-50"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() =>
                                            toggleModifier(row, code)
                                          }
                                        />
                                        <span>
                                          <span className="font-semibold text-gray-900">
                                            {code}
                                          </span>
                                          {rule.description ? (
                                            <span className="block text-gray-500">
                                              {rule.description}
                                            </span>
                                          ) : null}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className={DS_TD_PRIMARY}>
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300"
                                style={{ accentColor: "#0D9488" }}
                                checked={row.is_active}
                                disabled={readOnly || rowBusyId === row.id}
                                onChange={(e) =>
                                  void patchRow(row.id, {
                                    is_active: e.target.checked,
                                  })
                                }
                              />
                              <span className="text-xs text-gray-600">
                                {row.is_active ? "Yes" : "No"}
                              </span>
                            </label>
                          </td>
                          {!readOnly ? (
                            <td className={DS_TD_PRIMARY}>
                              <button
                                type="button"
                                className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                                disabled={rowBusyId === row.id}
                                onClick={() => void deleteRow(row.id)}
                              >
                                Delete
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {addOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-100 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">Add CPT code</h3>
            <label className={`${LABEL_CLASS} mt-4`}>
              Search CPT codes
              <input
                className={`mt-1 ${DS_INPUT}`}
                value={cptSearch}
                onChange={(e) => {
                  setCptSearch(e.target.value);
                  setSelectedCpt(null);
                }}
                placeholder="Code or description…"
              />
            </label>
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-100">
              {cptSearchBusy ? (
                <p className="px-3 py-2 text-sm text-gray-500">Searching…</p>
              ) : cptOptions.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-500">No matches</p>
              ) : (
                cptOptions.slice(0, 40).map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    className={[
                      "block w-full border-b border-gray-50 px-3 py-2 text-left text-sm last:border-0 hover:bg-gray-50",
                      selectedCpt?.code === c.code ? "bg-[#f0fdfa]" : "",
                    ].join(" ")}
                    onClick={() => setSelectedCpt(c)}
                  >
                    <span className="font-mono font-semibold">{c.code}</span>
                    <span className="ml-2 text-gray-600">{c.description}</span>
                  </button>
                ))
              )}
            </div>
            {selectedCpt ? (
              <p className="mt-2 text-xs text-gray-600">
                Selected: {selectedCpt.code} — {selectedCpt.description}
              </p>
            ) : null}
            <label className={`${LABEL_CLASS} mt-4`}>
              Charge
              <input
                type="number"
                step="0.01"
                min="0"
                className={`mt-1 ${DS_INPUT}`}
                value={addCharge}
                onChange={(e) => setAddCharge(e.target.value)}
              />
            </label>
            <div className="mt-4">
              <span className={LABEL_CLASS}>Modifiers</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {modifierRules.map((rule) => {
                  const code = rule.modifier_code;
                  const on = addModifiers.includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() =>
                        setAddModifiers((prev) =>
                          on
                            ? prev.filter((m) => m !== code)
                            : [...prev, code],
                        )
                      }
                      className={[
                        "rounded-full border px-2.5 py-1 text-xs font-medium",
                        on
                          ? "border-[#0D9488] bg-[#f0fdfa] text-[#0f766e]"
                          : "border-gray-200 bg-white text-gray-600",
                      ].join(" ")}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className={DS_SECONDARY_BTN}
                disabled={addBusy}
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${DS_PRIMARY_BTN} disabled:opacity-50`}
                style={{ backgroundColor: TEAL }}
                disabled={addBusy}
                onClick={() => void submitAddCode()}
              >
                {addBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

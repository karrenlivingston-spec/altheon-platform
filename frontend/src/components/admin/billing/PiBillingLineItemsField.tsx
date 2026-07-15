"use client";

import { useEffect, useRef } from "react";
import { Plus, X } from "lucide-react";

import { DS_INPUT } from "@/app/admin/designSystem";

export type RateSource = "auto" | "manual" | "saved";

export type LineItemDraft = {
  id: string;
  cptCode: string;
  rate: string;
  units: string;
  serverId?: string;
  rateSource?: RateSource;
};

export type LineFieldErrors = {
  cptCode?: string;
  rate?: string;
  units?: string;
};

export function normalizeCptCode(code: string): string {
  return code.trim().toUpperCase();
}

export function formatPiRateHint(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/** Apply PI schedule rate when the line is eligible for auto-fill. */
export function applyPiAutoFill(
  line: LineItemDraft,
  piRates: Map<string, number>,
): LineItemDraft {
  if (line.rateSource === "manual" || line.rateSource === "saved") {
    return line;
  }

  const code = normalizeCptCode(line.cptCode);
  if (!code) {
    return { ...line, rate: "", rateSource: "auto" };
  }

  const piRate = piRates.get(code);
  if (piRate != null && piRate > 0) {
    return {
      ...line,
      rate: piRate.toFixed(2),
      rateSource: "auto",
    };
  }

  return { ...line, rate: "", rateSource: "auto" };
}

export function piRateForLine(
  line: LineItemDraft,
  piRates: Map<string, number>,
): number | null {
  const code = normalizeCptCode(line.cptCode);
  if (!code) return null;
  const rate = piRates.get(code);
  return rate != null && rate > 0 ? rate : null;
}

export function emptyLine(): LineItemDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    cptCode: "",
    rate: "",
    units: "1",
    rateSource: "auto",
  };
}

export function validateLine(line: LineItemDraft): LineFieldErrors {
  const errs: LineFieldErrors = {};
  const rateNum = Number(line.rate);
  const unitsNum = Number(line.units);
  if (!line.cptCode.trim()) errs.cptCode = "Required.";
  if (!line.rate.trim() || Number.isNaN(rateNum) || rateNum <= 0) {
    errs.rate = "Enter a valid amount greater than zero.";
  }
  if (
    !line.units.trim() ||
    Number.isNaN(unitsNum) ||
    unitsNum <= 0 ||
    !Number.isInteger(unitsNum)
  ) {
    errs.units = "Enter a whole number greater than zero.";
  }
  return errs;
}

const CPT_AUTOFILL_DEBOUNCE_MS = 400;

export default function PiBillingLineItemsField({
  lines,
  onChange,
  fieldErrors,
  submitAttempted,
  disabled,
  piRates,
}: {
  lines: LineItemDraft[];
  onChange: (next: LineItemDraft[]) => void;
  fieldErrors: Record<number, LineFieldErrors> | undefined;
  submitAttempted: boolean;
  disabled: boolean;
  piRates?: Map<string, number>;
}) {
  const rates = piRates ?? new Map<string, number>();
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  function showLineErr(index: number, key: keyof LineFieldErrors) {
    if (!submitAttempted) return null;
    const msg = fieldErrors?.[index]?.[key];
    return msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null;
  }

  function updateLine(lineId: string, updater: (line: LineItemDraft) => LineItemDraft) {
    onChange(
      linesRef.current.map((row) => (row.id === lineId ? updater(row) : row)),
    );
  }

  function scheduleAutoFill(lineId: string, cptCode: string) {
    const existing = debounceTimers.current.get(lineId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      debounceTimers.current.delete(lineId);
      onChange(
        linesRef.current.map((row) => {
          if (row.id !== lineId) return row;
          return applyPiAutoFill({ ...row, cptCode }, rates);
        }),
      );
    }, CPT_AUTOFILL_DEBOUNCE_MS);

    debounceTimers.current.set(lineId, timer);
  }

  function handleCptChange(line: LineItemDraft, value: string) {
    const existing = debounceTimers.current.get(line.id);
    if (existing) clearTimeout(existing);
    debounceTimers.current.delete(line.id);

    updateLine(line.id, (row) => ({ ...row, cptCode: value }));

    if (line.rateSource !== "manual" && line.rateSource !== "saved") {
      scheduleAutoFill(line.id, value);
    }
  }

  function handleCptBlur(line: LineItemDraft) {
    const existing = debounceTimers.current.get(line.id);
    if (existing) {
      clearTimeout(existing);
      debounceTimers.current.delete(line.id);
    }

    if (line.rateSource === "manual" || line.rateSource === "saved") return;

    updateLine(line.id, (row) => applyPiAutoFill(row, rates));
  }

  function handleRateChange(line: LineItemDraft, value: string) {
    updateLine(line.id, (row) => ({
      ...row,
      rate: value,
      rateSource: "manual",
    }));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-gray-500">
          Line Items
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...lines, emptyLine()])}
          className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add line
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {lines.map((line, i) => {
          const scheduleRate = piRateForLine(line, rates);
          const showHint = scheduleRate != null;

          return (
            <div
              key={line.id}
              className="grid gap-2 rounded-lg border border-gray-100 bg-gray-50/50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  CPT Code
                </label>
                <input
                  type="text"
                  value={line.cptCode}
                  disabled={disabled}
                  onChange={(e) => handleCptChange(line, e.target.value)}
                  onBlur={() => handleCptBlur(line)}
                  className={DS_INPUT}
                  placeholder="e.g. 97110"
                />
                {showLineErr(i, "cptCode")}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Rate ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.rate}
                  disabled={disabled}
                  onChange={(e) => handleRateChange(line, e.target.value)}
                  className={DS_INPUT}
                  placeholder="0.00"
                />
                {showHint ? (
                  <p className="mt-1 text-xs text-gray-500">
                    PI schedule: {formatPiRateHint(scheduleRate)}
                  </p>
                ) : null}
                {showLineErr(i, "rate")}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Units
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.units}
                  disabled={disabled}
                  onChange={(e) =>
                    updateLine(line.id, (row) => ({
                      ...row,
                      units: e.target.value,
                    }))
                  }
                  className={DS_INPUT}
                />
                {showLineErr(i, "units")}
              </div>
              <div className="flex items-end pb-0.5 sm:pb-6">
                {lines.length > 1 ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onChange(lines.filter((row) => row.id !== line.id))
                    }
                    className="rounded-lg border border-gray-200 px-2 py-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    aria-label={`Remove line ${i + 1}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

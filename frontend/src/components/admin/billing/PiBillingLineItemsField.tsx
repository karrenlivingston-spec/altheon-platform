"use client";

import { Plus, X } from "lucide-react";

import { DS_INPUT } from "@/app/admin/designSystem";

export type LineItemDraft = {
  id: string;
  cptCode: string;
  rate: string;
  units: string;
  serverId?: string;
};

export type LineFieldErrors = {
  cptCode?: string;
  rate?: string;
  units?: string;
};

export function emptyLine(): LineItemDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    cptCode: "",
    rate: "",
    units: "1",
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

export default function PiBillingLineItemsField({
  lines,
  onChange,
  fieldErrors,
  submitAttempted,
  disabled,
}: {
  lines: LineItemDraft[];
  onChange: (next: LineItemDraft[]) => void;
  fieldErrors: Record<number, LineFieldErrors> | undefined;
  submitAttempted: boolean;
  disabled: boolean;
}) {
  function showLineErr(index: number, key: keyof LineFieldErrors) {
    if (!submitAttempted) return null;
    const msg = fieldErrors?.[index]?.[key];
    return msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null;
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
        {lines.map((line, i) => (
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
                onChange={(e) =>
                  onChange(
                    lines.map((row) =>
                      row.id === line.id
                        ? { ...row, cptCode: e.target.value }
                        : row,
                    ),
                  )
                }
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
                onChange={(e) =>
                  onChange(
                    lines.map((row) =>
                      row.id === line.id ? { ...row, rate: e.target.value } : row,
                    ),
                  )
                }
                className={DS_INPUT}
                placeholder="0.00"
              />
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
                  onChange(
                    lines.map((row) =>
                      row.id === line.id ? { ...row, units: e.target.value } : row,
                    ),
                  )
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
        ))}
      </div>
    </div>
  );
}

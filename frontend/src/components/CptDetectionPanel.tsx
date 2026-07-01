"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type CptCode = {
  cpt_code: string;
  description: string;
  charge: number;
  units?: number;
  modifiers: string[];
  reason: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidNoteId(noteId: string): boolean {
  return UUID_RE.test(noteId.trim());
}

function normalizeCodes(raw: unknown): CptCode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    .map((item) => ({
      cpt_code: String(item.cpt_code ?? "").trim(),
      description: String(item.description ?? "").trim(),
      charge: Number(item.charge) || 0,
      modifiers: Array.isArray(item.modifiers)
        ? item.modifiers.map((m) => String(m).trim()).filter(Boolean)
        : [],
      reason: String(item.reason ?? "").trim(),
    }))
    .filter((c) => c.cpt_code);
}

type Props = {
  noteId: string;
  clinicId: string;
  initialCodes?: CptCode[] | null;
  onCodesDetected?: (codes: CptCode[]) => void;
};

export default function CptDetectionPanel({
  noteId,
  clinicId,
  initialCodes,
  onCodesDetected,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [codes, setCodes] = useState<CptCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    const initial = normalizeCodes(initialCodes);
    setCodes(initial);
    setHasRun(initial.length > 0);
    setError(null);
  }, [noteId, initialCodes]);

  const detect = async () => {
    if (!isValidNoteId(noteId)) {
      setError("Save the note before running CPT detection.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/cpt-detection`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ note_id: noteId, clinic_id: clinicId }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t.trim() || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { cpt_codes?: unknown };
      const next = normalizeCodes(data.cpt_codes);
      setCodes(next);
      setHasRun(true);
      onCodesDetected?.(next);
    } catch (e) {
      setError("Detection failed. Please try again.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">CPT Code Detection</h3>
        <button
          type="button"
          onClick={() => void detect()}
          disabled={loading || !isValidNoteId(noteId)}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Detecting..." : hasRun ? "Re-detect" : "Detect CPT Codes"}
        </button>
      </div>

      {error ? <p className="mb-2 text-xs text-red-500">{error}</p> : null}

      {hasRun && codes.length === 0 && !loading ? (
        <p className="text-xs text-gray-500">
          No CPT codes matched. Review the note and try again.
        </p>
      ) : null}

      {codes.length > 0 ? (
        <div className="space-y-2">
          {codes.map((code, i) => (
            <div
              key={`${code.cpt_code}-${i}`}
              className="flex items-start justify-between rounded-md border border-gray-200 bg-white p-3"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-teal-700">
                    {code.cpt_code}
                  </span>
                  {code.modifiers?.map((mod) => (
                    <span
                      key={mod}
                      className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-xs text-blue-700"
                    >
                      {mod}
                    </span>
                  ))}
                  <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-semibold text-teal-700 border border-teal-200">
                    {code.units ?? 1} unit{(code.units ?? 1) !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{code.description}</p>
                <p className="mt-0.5 text-xs italic text-gray-400">{code.reason}</p>
              </div>
              <span className="ml-4 text-sm font-semibold text-gray-700">
                ${code.charge.toFixed(2)}
              </span>
            </div>
          ))}
          <div className="flex justify-end pt-1">
            <span className="text-sm font-semibold text-gray-800">
              Total: ${codes.reduce((sum, c) => sum + c.charge, 0).toFixed(2)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

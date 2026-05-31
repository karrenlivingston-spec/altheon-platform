"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

import { DS_INPUT } from "@/app/admin/designSystem";
import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const ACCENT = "#1A6B8A";

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
] as const;

export type BodyPartKey =
  | "shoulder"
  | "cervical"
  | "hip"
  | "knee"
  | "lumbar"
  | "wrist";

type RomTemplateRow = { label: string; normal: number };
type BodyPartTemplate = {
  rom: RomTemplateRow[];
  strength: string[];
  outcomes: string[];
};

export const BODY_PART_TEMPLATES: Record<BodyPartKey, BodyPartTemplate> = {
  shoulder: {
    rom: [
      { label: "Flexion", normal: 180 },
      { label: "Extension", normal: 60 },
      { label: "Abduction", normal: 180 },
      { label: "Internal rotation", normal: 70 },
      { label: "External rotation", normal: 90 },
    ],
    strength: ["Flexion (MMT)", "Abduction (MMT)", "External rotation (MMT)"],
    outcomes: ["DASH score", "QuickDASH"],
  },
  cervical: {
    rom: [
      { label: "Flexion", normal: 80 },
      { label: "Extension", normal: 50 },
      { label: "Lateral flexion", normal: 45 },
      { label: "Rotation", normal: 80 },
    ],
    strength: ["Deep neck flexors", "Neck extensors"],
    outcomes: ["NDI score", "VAS"],
  },
  hip: {
    rom: [
      { label: "Flexion", normal: 120 },
      { label: "Extension", normal: 30 },
      { label: "Abduction", normal: 45 },
      { label: "Internal rotation", normal: 45 },
      { label: "External rotation", normal: 45 },
    ],
    strength: ["Hip flexors (MMT)", "Glute med (MMT)", "Glute max (MMT)"],
    outcomes: ["HOOS score", "FABER test"],
  },
  knee: {
    rom: [
      { label: "Flexion", normal: 135 },
      { label: "Extension", normal: 0 },
    ],
    strength: ["Quad (MMT)", "Hamstring (MMT)"],
    outcomes: ["KOOS score", "Lachman test"],
  },
  lumbar: {
    rom: [
      { label: "Flexion", normal: 60 },
      { label: "Extension", normal: 25 },
      { label: "Lateral flexion", normal: 25 },
      { label: "Rotation", normal: 30 },
    ],
    strength: ["Core stability", "Hip extension"],
    outcomes: ["Oswestry score", "SLR test"],
  },
  wrist: {
    rom: [
      { label: "Wrist flexion", normal: 80 },
      { label: "Wrist extension", normal: 70 },
      { label: "Elbow flexion", normal: 150 },
    ],
    strength: ["Grip strength (lbs)", "Pinch strength (lbs)"],
    outcomes: ["PRWE score", "QuickDASH"],
  },
};

const BODY_PART_TABS: { key: BodyPartKey; label: string }[] = [
  { key: "shoulder", label: "Shoulder" },
  { key: "cervical", label: "Cervical" },
  { key: "hip", label: "Hip" },
  { key: "knee", label: "Knee" },
  { key: "lumbar", label: "Lumbar" },
  { key: "wrist", label: "Wrist/Elbow" },
];

type RomCellValues = {
  leftActive: string;
  leftPassive: string;
  rightActive: string;
  rightPassive: string;
};

type StrengthCellValues = { left: string; right: string };

type MeasurementApiRow = {
  id?: string;
  body_part?: string;
  rom?: Array<{
    label: string;
    left_active?: number | null;
    left_passive?: number | null;
    right_active?: number | null;
    right_passive?: number | null;
  }>;
  strength?: Array<{ label: string; left?: string | null; right?: string | null }>;
  functional_outcomes?: Array<{ label: string; score?: string | null }>;
  pain_nrs?: number | null;
};

export type MeasurementModuleProps = {
  appointmentId: string;
  clinicId: string;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function pickRecorderMimeType(): { mimeType: string; extension: string } {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      if (mime.includes("webm")) return { mimeType: mime, extension: "webm" };
      if (mime.includes("mp4")) return { mimeType: mime, extension: "mp4" };
      if (mime.includes("ogg")) return { mimeType: mime, extension: "ogg" };
    }
  }
  return { mimeType: "", extension: "webm" };
}

function normalizeBodyPartKey(raw: string | null | undefined): BodyPartKey {
  const s = (raw ?? "").trim().toLowerCase();
  if (s in BODY_PART_TEMPLATES) return s as BodyPartKey;
  if (s.includes("wrist") || s.includes("elbow")) return "wrist";
  return "shoulder";
}

function emptyRomValues(part: BodyPartKey): Record<string, RomCellValues> {
  const out: Record<string, RomCellValues> = {};
  for (const row of BODY_PART_TEMPLATES[part].rom) {
    out[row.label] = {
      leftActive: "",
      leftPassive: "",
      rightActive: "",
      rightPassive: "",
    };
  }
  return out;
}

function emptyStrengthValues(part: BodyPartKey): Record<string, StrengthCellValues> {
  const out: Record<string, StrengthCellValues> = {};
  for (const label of BODY_PART_TEMPLATES[part].strength) {
    out[label] = { left: "", right: "" };
  }
  return out;
}

function emptyOutcomeValues(part: BodyPartKey): Record<string, string> {
  const out: Record<string, string> = {};
  for (const label of BODY_PART_TEMPLATES[part].outcomes) {
    out[label] = "";
  }
  return out;
}

function numToStr(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  return String(v);
}

function populateFromApiRow(
  row: MeasurementApiRow,
  part: BodyPartKey,
): {
  romValues: Record<string, RomCellValues>;
  strengthValues: Record<string, StrengthCellValues>;
  outcomeValues: Record<string, string>;
  painNrs: number | null;
} {
  const romValues = emptyRomValues(part);
  for (const entry of row.rom ?? []) {
    const label = entry.label;
    if (!label || !romValues[label]) continue;
    romValues[label] = {
      leftActive: numToStr(entry.left_active),
      leftPassive: numToStr(entry.left_passive),
      rightActive: numToStr(entry.right_active),
      rightPassive: numToStr(entry.right_passive),
    };
  }

  const strengthValues = emptyStrengthValues(part);
  for (const entry of row.strength ?? []) {
    const label = entry.label;
    if (!label || !strengthValues[label]) continue;
    strengthValues[label] = {
      left: entry.left ?? "",
      right: entry.right ?? "",
    };
  }

  const outcomeValues = emptyOutcomeValues(part);
  for (const entry of row.functional_outcomes ?? []) {
    const label = entry.label;
    if (!label || !(label in outcomeValues)) continue;
    outcomeValues[label] = entry.score ?? "";
  }

  return {
    romValues,
    strengthValues,
    outcomeValues,
    painNrs:
      row.pain_nrs === null || row.pain_nrs === undefined
        ? null
        : Number(row.pain_nrs),
  };
}

/** Parse natural-language transcript into ROM field updates (label + number patterns). */
export function parseMeasurementTranscript(
  transcript: string,
  romLabels: string[],
): Record<string, Partial<RomCellValues>> {
  const lower = transcript.toLowerCase();
  const updates: Record<string, Partial<RomCellValues>> = {};

  for (const label of romLabels) {
    const labelLower = label.toLowerCase();
    if (!lower.includes(labelLower)) continue;

    const tryMatch = (
      side: "left" | "right",
      mode: "active" | "passive",
    ): string | null => {
      const sideRe = side === "left" ? "left" : "right";
      const modeRe = mode === "active" ? "active" : "passive";
      const patterns = [
        new RegExp(
          `${escapeRegExp(labelLower)}[^\\d]{0,40}(\\d+(?:\\.\\d+)?)[^\\d]{0,20}${sideRe}[^\\d]{0,20}${modeRe}`,
          "i",
        ),
        new RegExp(
          `${sideRe}[^\\d]{0,20}${modeRe}[^\\d]{0,40}${escapeRegExp(labelLower)}[^\\d]{0,20}(\\d+(?:\\.\\d+)?)`,
          "i",
        ),
        new RegExp(
          `${escapeRegExp(labelLower)}[^\\d]{0,40}(\\d+(?:\\.\\d+)?)[^\\d]{0,20}${sideRe}(?!\\s*passive)`,
          "i",
        ),
        new RegExp(
          `${sideRe}[^\\d]{0,20}${escapeRegExp(labelLower)}[^\\d]{0,20}(\\d+(?:\\.\\d+)?)`,
          "i",
        ),
      ];
      for (const re of patterns) {
        const m = lower.match(re);
        if (m?.[1]) return m[1];
      }
      return null;
    };

    const patch: Partial<RomCellValues> = {};
    const la = tryMatch("left", "active");
    const lp = tryMatch("left", "passive");
    const ra = tryMatch("right", "active");
    const rp = tryMatch("right", "passive");
    if (la) patch.leftActive = la;
    if (lp) patch.leftPassive = lp;
    if (ra) patch.rightActive = ra;
    if (rp) patch.rightPassive = rp;
    if (Object.keys(patch).length > 0) {
      updates[label] = patch;
    }
  }

  return updates;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function painNrsColor(n: number): string {
  if (n <= 3) return "#16A34A";
  if (n <= 6) return "#D97706";
  return "#DC2626";
}

function romCellClass(value: string, normal: number): string {
  const base = `w-full min-w-[3.5rem] rounded-md border px-2 py-1.5 text-sm text-gray-900 ${DS_INPUT}`;
  if (!value.trim()) return base;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return base;
  if (normal > 0 && n < normal * 0.75) {
    return `${base} border-amber-400 bg-amber-50/80 ring-1 ring-amber-300`;
  }
  return base;
}

export function MeasurementModule({
  appointmentId,
  clinicId,
}: MeasurementModuleProps) {
  const [selectedBodyPart, setSelectedBodyPart] = useState<BodyPartKey>("shoulder");
  const [romValues, setRomValues] = useState<Record<string, RomCellValues>>(() =>
    emptyRomValues("shoulder"),
  );
  const [strengthValues, setStrengthValues] = useState<
    Record<string, StrengthCellValues>
  >(() => emptyStrengthValues("shoulder"));
  const [outcomeValues, setOutcomeValues] = useState<Record<string, string>>(() =>
    emptyOutcomeValues("shoulder"),
  );
  const [painNrs, setPainNrs] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const savedRowRef = useRef<MeasurementApiRow | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeRef = useRef<{ mimeType: string; extension: string }>({
    mimeType: "",
    extension: "webm",
  });

  const template = BODY_PART_TEMPLATES[selectedBodyPart];

  const applyPartState = useCallback((part: BodyPartKey, row: MeasurementApiRow | null) => {
    if (row && normalizeBodyPartKey(row.body_part) === part) {
      const populated = populateFromApiRow(row, part);
      setRomValues(populated.romValues);
      setStrengthValues(populated.strengthValues);
      setOutcomeValues(populated.outcomeValues);
      setPainNrs(populated.painNrs);
    } else {
      setRomValues(emptyRomValues(part));
      setStrengthValues(emptyStrengthValues(part));
      setOutcomeValues(emptyOutcomeValues(part));
      setPainNrs(null);
    }
  }, []);

  const handleBodyPartChange = useCallback(
    (part: BodyPartKey) => {
      setSelectedBodyPart(part);
      applyPartState(part, savedRowRef.current);
    },
    [applyPartState],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/measurements`,
          { headers: await authHeaders() },
        );
        if (!res.ok) {
          if (!cancelled) {
            setLoadError(`Could not load measurements (HTTP ${res.status})`);
          }
          return;
        }
        const json = (await res.json()) as MeasurementApiRow & { data?: null };
        if (cancelled) return;
        if (json && json.data === null) {
          savedRowRef.current = null;
          applyPartState(selectedBodyPart, null);
          return;
        }
        if (json?.id || json?.body_part) {
          savedRowRef.current = json;
          const part = normalizeBodyPartKey(json.body_part);
          setSelectedBodyPart(part);
          applyPartState(part, json);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Failed to load measurements",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when appointment changes
  }, [appointmentId]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    setSaveError(null);
    const { mimeType, extension } = pickRecorderMimeType();
    mimeRef.current = { mimeType, extension };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const options: MediaRecorderOptions = {};
      if (mimeType) options.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(1000);
      setIsRecording(true);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message : "Could not access microphone.",
      );
    }
  }, []);

  const stopRecordingAndTranscribe = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setIsRecording(false);
      stopStream();
      return;
    }

    setIsRecording(false);
    setIsTranscribing(true);
    setSaveError(null);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    stopStream();

    const { extension } = mimeRef.current;
    const mime =
      recorder.mimeType ||
      (extension === "mp4" ? "audio/mp4" : extension === "ogg" ? "audio/ogg" : "audio/webm");
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    mediaRecorderRef.current = null;

    if (blob.size === 0) {
      setIsTranscribing(false);
      setSaveError("No audio captured.");
      return;
    }

    try {
      const form = new FormData();
      form.append("audio", blob, `measurements.${extension}`);
      form.append("clinic_id", clinicId.trim());

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/soap-dictation/transcribe`, {
        method: "POST",
        headers,
        body: form,
      });
      if (!res.ok) {
        setSaveError(await res.text().catch(() => res.statusText));
        return;
      }
      const data = (await res.json()) as { transcript?: string };
      const text = String(data.transcript ?? "").trim();
      setTranscript((prev) => (prev ? `${prev}\n${text}` : text));

      const romLabels = template.rom.map((r) => r.label);
      const parsed = parseMeasurementTranscript(text, romLabels);
      if (Object.keys(parsed).length > 0) {
        setRomValues((prev) => {
          const next = { ...prev };
          for (const [label, patch] of Object.entries(parsed)) {
            next[label] = { ...next[label], ...patch };
          }
          return next;
        });
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  }, [clinicId, stopStream, template.rom]);

  const saveMeasurements = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const body = {
        body_part: selectedBodyPart,
        rom: template.rom.map((row) => {
          const v = romValues[row.label] ?? {
            leftActive: "",
            leftPassive: "",
            rightActive: "",
            rightPassive: "",
          };
          const parseNum = (s: string) => {
            const t = s.trim();
            if (!t) return null;
            const n = parseFloat(t);
            return Number.isNaN(n) ? null : n;
          };
          return {
            label: row.label,
            left_active: parseNum(v.leftActive),
            left_passive: parseNum(v.leftPassive),
            right_active: parseNum(v.rightActive),
            right_passive: parseNum(v.rightPassive),
          };
        }),
        strength: template.strength.map((label) => {
          const v = strengthValues[label] ?? { left: "", right: "" };
          return {
            label,
            left: v.left.trim() || null,
            right: v.right.trim() || null,
          };
        }),
        functional_outcomes: template.outcomes.map((label) => ({
          label,
          score: (outcomeValues[label] ?? "").trim() || null,
        })),
        pain_nrs: painNrs,
        notes: null,
      };

      const res = await fetch(
        `${API_BASE}/appointments/${encodeURIComponent(appointmentId)}/measurements`,
        {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        setSaveError(await res.text().catch(() => res.statusText));
        return;
      }
      const saved = (await res.json()) as MeasurementApiRow;
      savedRowRef.current = saved;
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }, [
    appointmentId,
    outcomeValues,
    painNrs,
    romValues,
    selectedBodyPart,
    strengthValues,
    template,
  ]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} />
        Loading measurements…
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h4
        className="text-sm font-semibold uppercase tracking-wide"
        style={{ color: ACCENT }}
      >
        Smart measurements
      </h4>

      {loadError ? (
        <p className="mt-2 text-sm text-amber-700">{loadError}</p>
      ) : null}

      {/* Voice dictation bar */}
      <div className="mt-4 rounded-lg border border-gray-100 bg-slate-50/90 p-3">
        <div className="flex flex-wrap items-center gap-3">
          {!isRecording ? (
            <button
              type="button"
              disabled={isTranscribing}
              onClick={() => void startRecording()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              <Mic className="h-4 w-4" aria-hidden />
              Dictate
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void stopRecordingAndTranscribe()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700"
            >
              <span
                className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-red-600"
                aria-hidden
              />
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
              Stop
            </button>
          )}
          {isTranscribing ? (
            <span className="inline-flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: ACCENT }} />
              Transcribing…
            </span>
          ) : null}
        </div>
        <textarea
          readOnly
          value={transcript}
          placeholder="Transcript will appear here after dictation…"
          rows={2}
          className={`mt-3 w-full resize-y ${DS_INPUT} bg-white text-sm text-gray-700`}
        />
      </div>

      {/* Body part tabs */}
      <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-100 pb-2">
        {BODY_PART_TABS.map((tab) => {
          const active = tab.key === selectedBodyPart;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleBodyPartChange(tab.key)}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                active
                  ? "text-white"
                  : "text-gray-600 hover:bg-gray-100",
              ].join(" ")}
              style={active ? { backgroundColor: ACCENT } : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ROM table */}
      <div className="mt-4 overflow-x-auto">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Range of motion (°)
        </p>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="py-2 pr-3 font-medium">Movement</th>
              <th className="px-2 py-2 font-medium">Left active</th>
              <th className="px-2 py-2 font-medium">Left passive</th>
              <th className="px-2 py-2 font-medium">Right active</th>
              <th className="px-2 py-2 font-medium">Right passive</th>
            </tr>
          </thead>
          <tbody>
            {template.rom.map((row) => {
              const v = romValues[row.label] ?? {
                leftActive: "",
                leftPassive: "",
                rightActive: "",
                rightPassive: "",
              };
              return (
                <tr key={row.label} className="border-b border-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-800">
                    {row.label}
                    <span className="ml-1 text-xs font-normal text-gray-400">
                      ({row.normal}°)
                    </span>
                  </td>
                  {(
                    [
                      ["leftActive", v.leftActive],
                      ["leftPassive", v.leftPassive],
                      ["rightActive", v.rightActive],
                      ["rightPassive", v.rightPassive],
                    ] as const
                  ).map(([field, val]) => (
                    <td key={field} className="px-2 py-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        value={val}
                        onChange={(e) =>
                          setRomValues((prev) => ({
                            ...prev,
                            [row.label]: {
                              ...(prev[row.label] ?? {
                                leftActive: "",
                                leftPassive: "",
                                rightActive: "",
                                rightPassive: "",
                              }),
                              [field]: e.target.value,
                            },
                          }))
                        }
                        className={romCellClass(val, row.normal)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Strength table */}
      <div className="mt-6 overflow-x-auto">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Strength
        </p>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-500">
              <th className="py-2 pr-3 font-medium">Movement</th>
              <th className="px-2 py-2 font-medium">Left</th>
              <th className="px-2 py-2 font-medium">Right</th>
            </tr>
          </thead>
          <tbody>
            {template.strength.map((label) => {
              const v = strengthValues[label] ?? { left: "", right: "" };
              return (
                <tr key={label} className="border-b border-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-800">{label}</td>
                  {(["left", "right"] as const).map((side) => (
                    <td key={side} className="px-2 py-2">
                      <input
                        type="text"
                        value={v[side]}
                        onChange={(e) =>
                          setStrengthValues((prev) => ({
                            ...prev,
                            [label]: { ...prev[label], [side]: e.target.value },
                          }))
                        }
                        placeholder="4/5"
                        className={`w-full min-w-[4rem] ${DS_INPUT}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Functional outcomes */}
      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Functional outcomes
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {template.outcomes.map((label) => (
            <label key={label} className="block text-sm text-gray-700">
              <span className="text-xs font-medium text-gray-500">{label}</span>
              <input
                type="text"
                value={outcomeValues[label] ?? ""}
                onChange={(e) =>
                  setOutcomeValues((prev) => ({
                    ...prev,
                    [label]: e.target.value,
                  }))
                }
                className={`mt-1 ${DS_INPUT}`}
              />
            </label>
          ))}
        </div>
      </div>

      {/* Pain NRS */}
      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Pain NRS
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 11 }, (_, i) => {
            const selected = painNrs === i;
            const color = painNrsColor(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => setPainNrs(i)}
                className={[
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all",
                  selected ? "text-white" : "border-gray-200 bg-white text-gray-700 hover:border-gray-300",
                ].join(" ")}
                style={
                  selected
                    ? { backgroundColor: color, borderColor: color }
                    : undefined
                }
                aria-label={`Pain score ${i}`}
                aria-pressed={selected}
              >
                {i}
              </button>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => void saveMeasurements()}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: ACCENT }}
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            "Save measurements"
          )}
        </button>
        {saveSuccess ? (
          <span className="text-sm font-medium text-green-700">Saved</span>
        ) : null}
        {saveError ? (
          <span className="text-sm text-red-700">{saveError}</span>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { DS_PRIMARY_BTN, DS_SECONDARY_BTN } from "@/app/admin/designSystem";
import { apiAuthHeaders } from "@/lib/apiAuth";

const API_BASE = "https://altheon-platform.onrender.com";

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
] as const;

export type ScribeSpecialTestResult = {
  test_id: string;
  test_name: string;
  result: string;
  clinician_notes: string | null;
};

export type SoapFromScribe = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  transcript: string;
  body_region?: string | null;
  auto_populated_special_tests: string[];
  special_test_results: ScribeSpecialTestResult[];
};

type ScribeUiState = "idle" | "recording" | "processing" | "error";

function pickRecorderMimeType(): { mimeType: string; extension: string } {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      if (mime.includes("webm")) {
        return { mimeType: mime, extension: "webm" };
      }
      if (mime.includes("mp4")) {
        return { mimeType: mime, extension: "mp4" };
      }
      if (mime.includes("ogg")) {
        return { mimeType: mime, extension: "ogg" };
      }
    }
  }
  return { mimeType: "", extension: "webm" };
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type AmbientScribeProps = {
  clinicId: string;
  patientId?: string;
  /** When dictating into an existing note, results are auto-saved server-side. */
  noteId?: string;
  onSoapGenerated: (soap: SoapFromScribe) => void;
};

export function AmbientScribe({
  clinicId,
  patientId,
  noteId,
  onSoapGenerated,
}: AmbientScribeProps) {
  const [uiState, setUiState] = useState<ScribeUiState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const chunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef<{ mimeType: string; extension: string }>({
    mimeType: "",
    extension: "webm",
  });

  const stopStreamTracks = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) {
        t.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current = null;
      stopStreamTracks();
    };
  }, [clearTimer, stopStreamTracks]);

  const resetToIdle = useCallback(() => {
    clearTimer();
    stopStreamTracks();
    try {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") {
        mr.stop();
      }
    } catch {
      /* ignore */
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setElapsedSec(0);
    setErrorMessage(null);
    setUiState("idle");
  }, [clearTimer, stopStreamTracks]);

  const startSession = useCallback(async () => {
    setErrorMessage(null);
    if (!clinicId.trim()) {
      setErrorMessage("Missing clinic.");
      setUiState("error");
      return;
    }

    const { mimeType, extension } = pickRecorderMimeType();
    mimeRef.current = { mimeType, extension };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = () => {
        setErrorMessage("Recording error.");
        setUiState("error");
        stopStreamTracks();
        clearTimer();
      };

      recorder.start(1000);
      setElapsedSec(0);
      setUiState("recording");

      clearTimer();
      timerRef.current = setInterval(() => {
        setElapsedSec((x) => x + 1);
      }, 1000);
    } catch (e) {
      stopStreamTracks();
      setErrorMessage(
        e instanceof Error ? e.message : "Could not access microphone.",
      );
      setUiState("error");
    }
  }, [clinicId, clearTimer, stopStreamTracks]);

  const stopAndGenerate = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      resetToIdle();
      return;
    }

    clearTimer();
    setUiState("processing");

    recorder.onstop = async () => {
      stopStreamTracks();
      const { extension } = mimeRef.current;
      const mime =
        recorder.mimeType ||
        (extension === "mp4"
          ? "audio/mp4"
          : extension === "ogg"
            ? "audio/ogg"
            : "audio/webm");
      const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
      chunksRef.current = [];

      if (blob.size === 0) {
        setErrorMessage("No audio captured. Try again.");
        setUiState("error");
        mediaRecorderRef.current = null;
        return;
      }

      const filename = `session-recording.${extension}`;

      try {
        const form = new FormData();
        form.append("audio", blob, filename);
        form.append("clinic_id", clinicId.trim());
        form.append("patient_id", (patientId ?? "").trim());
        form.append("note_id", (noteId ?? "").trim());

        const headers = await apiAuthHeaders();
        delete headers["Content-Type"];

        const res = await fetch(
          `${API_BASE}/soap-dictation/transcribe-and-generate`,
          {
            method: "POST",
            headers,
            body: form,
          },
        );

        if (!res.ok) {
          const detail = await res.text().catch(() => res.statusText);
          setErrorMessage(detail || `Request failed (${res.status})`);
          setUiState("error");
          mediaRecorderRef.current = null;
          return;
        }

        const data = (await res.json()) as Record<string, unknown>;
        const autoNames = Array.isArray(data.auto_populated_special_tests)
          ? data.auto_populated_special_tests.map((x) => String(x))
          : [];
        const testResults = Array.isArray(data.special_test_results)
          ? (data.special_test_results as ScribeSpecialTestResult[])
          : [];
        onSoapGenerated({
          subjective: String(data.subjective ?? ""),
          objective: String(data.objective ?? ""),
          assessment: String(data.assessment ?? ""),
          plan: String(data.plan ?? ""),
          transcript: String(data.transcript ?? ""),
          body_region: data.body_region ? String(data.body_region) : null,
          auto_populated_special_tests: autoNames,
          special_test_results: testResults,
        });
        resetToIdle();
      } catch (e) {
        setErrorMessage(
          e instanceof Error ? e.message : "Network or server error.",
        );
        setUiState("error");
      }
      mediaRecorderRef.current = null;
    };

    try {
      recorder.stop();
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : "Failed to stop recording.",
      );
      setUiState("error");
      stopStreamTracks();
      mediaRecorderRef.current = null;
    }
  }, [
    clinicId,
    patientId,
    noteId,
    onSoapGenerated,
    resetToIdle,
    clearTimer,
    stopStreamTracks,
  ]);

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 sm:p-5">
      {uiState === "idle" ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void startSession()}
            className={`${DS_PRIMARY_BTN} min-h-[44px] w-full min-w-[44px] px-4 py-3 text-base sm:w-auto sm:min-w-[12rem]`}
          >
            Start Session
          </button>
          <p className="max-w-xl text-xs leading-relaxed text-gray-600 sm:text-sm">
            By starting a session, you confirm the patient has consented to
            recording.
          </p>
        </div>
      ) : null}

      {uiState === "recording" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex h-3 w-3 shrink-0 rounded-full bg-red-600 animate-pulse"
              aria-hidden
            />
            <span className="text-sm font-medium text-gray-900 sm:text-base">
              Recording in progress
            </span>
            <span className="font-mono text-sm tabular-nums text-gray-600 sm:text-base">
              {formatElapsed(elapsedSec)}
            </span>
          </div>
          <button
            type="button"
            onClick={stopAndGenerate}
            className={`${DS_SECONDARY_BTN} min-h-[44px] w-full border-red-200 bg-white py-3 text-red-800 hover:bg-red-50 sm:w-auto sm:px-6`}
          >
            Stop &amp; Generate Note
          </button>
        </div>
      ) : null}

      {uiState === "processing" ? (
        <div
          className="flex min-h-[44px] flex-col items-start gap-3 sm:flex-row sm:items-center"
          aria-busy
        >
          <Loader2 className="h-8 w-8 shrink-0 animate-spin text-[var(--color-primary,#16A34A)]" />
          <p className="text-sm text-gray-700 sm:text-base">
            Transcribing and generating your SOAP note…
          </p>
        </div>
      ) : null}

      {uiState === "error" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-red-700 sm:text-base">
            {errorMessage ?? "Something went wrong."}
          </p>
          <button
            type="button"
            onClick={resetToIdle}
            className={`${DS_PRIMARY_BTN} min-h-[44px] min-w-[44px] self-start px-5 py-3`}
          >
            Try Again
          </button>
        </div>
      ) : null}
    </div>
  );
}

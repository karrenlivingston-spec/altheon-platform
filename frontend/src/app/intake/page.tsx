"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Image from "next/image";
import { Mic, PhoneOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STTPDN_CLINIC_ID_FALLBACK =
  process.env.NEXT_PUBLIC_INTAKE_CLINIC_ID ??
  "804e2fd2-1c5e-49ec-a036-3feedd1bad50";

const EARLY_DISCONNECT_COPY =
  "Something went wrong. Please try again or ask the front desk for help.";

/** True when the event is from Aria (agent), not user/VAD/ping (best-effort across SDK event shapes). */
function isAriaAgentMessage(event: unknown): boolean {
  if (event == null || typeof event !== "object") return false;
  const e = event as Record<string, unknown>;
  const type = String(e.type ?? "");
  if (
    /user_transcript|user_transcription|vad_score|ping|pong|client_tool|conversation_initiation_metadata/i.test(
      type,
    )
  ) {
    return false;
  }
  if (/agent_response|agent_audio|tentative_agent|agent_chat_response/i.test(type)) {
    return true;
  }
  if ("agent_response_event" in e || "audio_event" in e) return true;
  return false;
}

function statusLabel(status: string): string {
  switch (status) {
    case "connecting":
      return "Connecting…";
    case "connected":
      return "You're connected — speak naturally";
    default:
      return "Tap to speak with Aria";
  }
}

function IntakePageInner() {
  const [complete, setComplete] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const conversationStartedRef = useRef(false);

  const agentId = useMemo(
    () => (process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "").trim(),
    [],
  );

  useEffect(() => {
    console.log(
      "[intake] mount — NEXT_PUBLIC_ELEVENLABS_AGENT_ID:",
      agentId || "(empty or undefined)",
    );
  }, [agentId]);

  const resetConversationTracking = useCallback(() => {
    conversationStartedRef.current = false;
    setConversationStarted(false);
  }, []);

  const onConversationSuccessEnd = useCallback(() => {
    if (!conversationStartedRef.current) {
      return;
    }
    setComplete(true);
    setBanner(null);
  }, []);

  const onConversationError = useCallback((message: string) => {
    const line =
      message?.trim() ||
      "Something went wrong. Please try again or ask the front desk.";
    setBanner(line);
  }, []);

  const { startSession, endSession, status, isSpeaking } = useConversation({
    onMessage: (event) => {
      if (conversationStartedRef.current) return;
      if (!isAriaAgentMessage(event)) return;
      conversationStartedRef.current = true;
      setConversationStarted(true);
      console.log("[intake] first message from Aria (conversationStarted = true)", event);
    },
    onDisconnect: (details: { reason: string; message?: unknown }) => {
      console.log("[intake] onDisconnect reason:", details.reason, "details:", details);
      if (details.reason === "error") {
        const msg =
          typeof details.message === "string"
            ? details.message
            : "Connection error";
        console.error(
          "[intake] onDisconnect (reason=error), message:",
          msg,
        );
        onConversationError(msg);
        resetConversationTracking();
        return;
      }
      if (!conversationStartedRef.current) {
        console.warn(
          "[intake] disconnect before any agent message — showing error, not completion",
        );
        setBanner(EARLY_DISCONNECT_COPY);
        resetConversationTracking();
        return;
      }
      onConversationSuccessEnd();
    },
    onError: (message) => {
      const m = typeof message === "string" ? message : "Connection error";
      console.error("[intake] useConversation onError callback:", m);
      onConversationError(m);
    },
  });

  const handleStart = async () => {
    if (!agentId) {
      setBanner("Intake voice is not configured. Please ask the front desk for help.");
      return;
    }
    setComplete(false);
    resetConversationTracking();
    setBanner(null);
    setBusy(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("[intake] startSession", {
        agentId,
        connectionType: "webrtc",
      });
      await startSession({
        agentId,
        connectionType: "webrtc",
        dynamicVariables: {
          clinic_id: STTPDN_CLINIC_ID_FALLBACK,
        },
      });
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Could not start. Check microphone permission and try again.";
      console.error("[intake] startSession failed:", e);
      setBanner(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleEnd = async () => {
    setBusy(true);
    try {
      await endSession();
    } catch (err) {
      console.error("[intake] endSession failed:", err);
      setBanner("Could not end the session cleanly. You can close this page.");
    } finally {
      setBusy(false);
    }
  };

  const sessionEndedSuccessfully = complete && conversationStarted;

  if (sessionEndedSuccessfully) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-center"
        style={{
          background: "linear-gradient(160deg, #0f2f2a 0%, #0b1f2d 100%)",
        }}
      >
        <div className="max-w-lg rounded-2xl border border-[#16A34A]/40 bg-[#0a1815]/90 px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#16A34A]/20 text-[#4ade80]">
            <span className="text-3xl leading-none">✓</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Thank you! Your intake is complete.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[#c7eae4]">
            Please let the front desk know you&apos;re ready.
          </p>
        </div>
      </div>
    );
  }

  const connected = status === "connected" || status === "connecting";

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4 pb-16 pt-10 sm:px-8"
      style={{
        background: "linear-gradient(160deg, #0f2f2a 0%, #0b1f2d 100%)",
      }}
    >
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-8">
          <Image
            src="/altheon-logo-white.png"
            alt="Straight To The Point Dry Needling"
            width={260}
            height={72}
            priority
            className="mx-auto h-16 w-auto"
          />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Welcome to Straight To The Point Dry Needling
        </h1>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[#c7eae4]/95">
          Please speak with Aria to complete your intake
        </p>

        {banner ? (
          <div
            className="mt-6 w-full rounded-xl border border-amber-500/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100"
            role="alert"
          >
            {banner}
          </div>
        ) : null}

        <div className="mt-10 flex flex-col items-center gap-6">
          <div className="relative">
            {isSpeaking ? (
              <span
                className="absolute inset-0 rounded-full bg-[#16A34A]/25 animate-pulse"
                aria-hidden
              />
            ) : null}
            {!connected ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleStart()}
                className="relative flex h-36 w-36 items-center justify-center rounded-full bg-[#16A34A] text-white shadow-[0_12px_40px_rgba(22,163,74,0.45)] ring-4 ring-[#16A34A]/30 transition hover:bg-[#15803d] hover:shadow-[0_14px_48px_rgba(22,163,74,0.5)] focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 disabled:opacity-50"
                aria-label="Start speaking with Aria"
              >
                <Mic className="h-16 w-16" strokeWidth={1.5} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleEnd()}
                className="relative flex h-36 w-36 flex-col items-center justify-center gap-1 rounded-full border-2 border-white/25 bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/15 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#16A34A]/50 disabled:opacity-50"
                aria-label="End conversation"
              >
                <PhoneOff className="h-14 w-14 text-[#f87171]" strokeWidth={1.5} />
                <span className="text-xs font-medium uppercase tracking-wide text-white/70">
                  End
                </span>
              </button>
            )}
          </div>

          <p className="max-w-sm text-sm text-[#9dd4cb]">{statusLabel(status)}</p>
          {!agentId ? (
            <p className="text-xs text-[#fcd34d]/90">
              Missing NEXT_PUBLIC_ELEVENLABS_AGENT_ID — voice cannot start until it is set.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function IntakePage() {
  return (
    <ConversationProvider>
      <IntakePageInner />
    </ConversationProvider>
  );
}

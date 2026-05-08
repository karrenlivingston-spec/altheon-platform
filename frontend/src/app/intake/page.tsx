"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import Image from "next/image";
import { Mic, PhoneOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const ERROR_COPY =
  "Something went wrong. Please try again or ask the front desk for help.";

/** First agent-side message implies conversationStarted for completion gating. */
function isAgentSideMessage(event: unknown): boolean {
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
  const source = String((e as { source?: unknown }).source ?? "").toLowerCase();
  if (source === "ai") return true;
  return false;
}

function IntakeInner() {
  const [complete, setComplete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const conversationStartedRef = useRef(false);

  const resetAfterError = useCallback(() => {
    conversationStartedRef.current = false;
    setErrorMessage(null);
  }, []);

  const { startSession, endSession, status, message: statusMessage } =
    useConversation({
      onMessage: (event) => {
        if (conversationStartedRef.current) return;
        if (!isAgentSideMessage(event)) return;
        conversationStartedRef.current = true;
      },
      onDisconnect: (details) => {
        if (details.reason === "error") {
          const msg =
            typeof details.message === "string"
              ? details.message
              : ERROR_COPY;
          setErrorMessage(msg);
          conversationStartedRef.current = false;
          return;
        }
        if (conversationStartedRef.current) {
          setComplete(true);
        }
        conversationStartedRef.current = false;
      },
      onError: (msg) => {
        const m = typeof msg === "string" ? msg : ERROR_COPY;
        setErrorMessage(m);
        conversationStartedRef.current = false;
      },
    });

  useEffect(() => {
    if (status === "error" && statusMessage) {
      setErrorMessage(statusMessage);
      conversationStartedRef.current = false;
    }
  }, [status, statusMessage]);

  const handleStart = () => {
    setErrorMessage(null);
    setComplete(false);
    conversationStartedRef.current = false;
    startSession({
      onConnect: () => console.log("[intake] connected"),
      onError: (e) => console.error("[intake] error", e),
    });
  };

  const handleEnd = () => {
    endSession();
  };

  const handleRetry = () => {
    resetAfterError();
    try {
      endSession();
    } catch {
      /* ignore */
    }
  };

  const connecting = status === "connecting";
  const connected = status === "connected";

  const statusText = (() => {
    if (complete) return "";
    if (errorMessage) return "";
    if (connecting) return "Connecting...";
    if (connected) return "Tap to end";
    return "Tap to speak with Aria";
  })();

  if (complete) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
        style={{
          background: "linear-gradient(160deg, #0f2f2a 0%, #0b1f2d 100%)",
        }}
        role="dialog"
        aria-live="polite"
        aria-label="Intake complete"
      >
        <div className="max-w-lg rounded-2xl border border-[#16A34A]/40 bg-[#0a1815]/90 px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#16A34A]/20 text-[#4ade80]">
            <span className="text-3xl leading-none">✓</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Thank you! Your intake is complete.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#c7eae4]">
            Please have a seat — the team will call you shortly.
          </p>
        </div>
      </div>
    );
  }

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

        {errorMessage ? (
          <div className="mt-8 w-full space-y-3">
            <p
              className="rounded-xl border border-amber-500/35 bg-amber-950/40 px-4 py-3 text-sm text-amber-100"
              role="alert"
            >
              {ERROR_COPY}
            </p>
            <button
              type="button"
              onClick={() => handleRetry()}
              className="w-full rounded-lg border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
            >
              Try again
            </button>
          </div>
        ) : null}

        <div className="mt-12 flex flex-col items-center gap-6">
          {connected ? (
            <button
              type="button"
              onClick={() => handleEnd()}
              className="flex h-36 w-36 flex-col items-center justify-center gap-1 rounded-full border-2 border-white/20 bg-[#b91c1c] text-white shadow-[0_12px_40px_rgba(185,28,28,0.45)] transition hover:bg-[#991b1b] focus:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
              aria-label="End conversation"
            >
              <PhoneOff className="h-14 w-14" strokeWidth={1.5} aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleStart()}
              disabled={connecting}
              className="flex h-36 w-36 items-center justify-center rounded-full bg-[#16A34A] text-white shadow-[0_12px_40px_rgba(22,163,74,0.45)] ring-4 ring-[#16A34A]/30 transition hover:bg-[#15803d] focus:outline-none focus-visible:ring-4 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Start speaking with Aria"
            >
              <Mic className="h-16 w-16" strokeWidth={1.5} aria-hidden />
            </button>
          )}

          <p className="max-w-sm text-sm text-[#9dd4cb]">{statusText}</p>
        </div>
      </div>
    </div>
  );
}

export default function IntakePage() {
  return (
    <ConversationProvider
      agentId="agent_8201kr28yvzqfws937kzq7tkdb93"
      connectionType="webrtc"
    >
      <IntakeInner />
    </ConversationProvider>
  );
}

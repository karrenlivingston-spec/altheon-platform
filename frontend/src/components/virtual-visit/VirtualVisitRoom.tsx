"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type SimplePeer from "simple-peer";

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const TEAL = "#0d9488";
const PAGE_BG = "linear-gradient(160deg, #0f2f2f 0%, #0b1f2d 100%)";

type VisitInfo = {
  room_id: string;
  status: string;
  clinician_name: string;
  clinic_name: string;
  started_at: string | null;
};

type Phase =
  | "loading"
  | "name"
  | "connecting"
  | "in_call"
  | "completed"
  | "error";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function nameStorageKey(roomId: string): string {
  return `virtual_visit_name_${roomId}`;
}

type VirtualVisitRoomProps = {
  roomId: string;
};

export default function VirtualVisitRoom({ roomId }: VirtualVisitRoomProps) {
  const searchParams = useSearchParams();
  const isClinician = searchParams.get("role") === "clinician";
  const clinicIdParam = searchParams.get("clinic_id") ?? "";

  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<VisitInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Connecting…");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [completedDuration, setCompletedDuration] = useState(0);
  const [ending, setEnding] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<InstanceType<typeof SimplePeer> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sessionStartRef = useRef<Date | null>(null);

  const cleanupMedia = useCallback(() => {
    peerRef.current?.destroy();
    peerRef.current = null;
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  useEffect(() => {
    if (!roomId) {
      setLoadError("Invalid visit link.");
      setPhase("error");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/visits/${encodeURIComponent(roomId)}/info`,
        );
        if (cancelled) return;
        if (res.status === 410) {
          setLoadError("This visit has already ended.");
          setPhase("error");
          return;
        }
        if (!res.ok) {
          setLoadError("This visit link is not valid.");
          setPhase("error");
          return;
        }
        const json = (await res.json()) as VisitInfo;
        setInfo(json);
        const stored =
          typeof window !== "undefined"
            ? sessionStorage.getItem(nameStorageKey(roomId))
            : null;
        if (stored?.trim()) {
          setParticipantName(stored.trim());
          setPhase("connecting");
        } else {
          setPhase("name");
        }
      } catch {
        if (!cancelled) {
          setLoadError("Could not load visit information.");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (phase !== "in_call" || !sessionStartRef.current) return;
    const tick = () => {
      const start = sessionStartRef.current;
      if (!start) return;
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000)),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const setupWebRtc = useCallback(
    async (displayName: string, role: "clinician" | "patient") => {
      setConnectionStatus("Requesting camera and microphone…");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      } catch {
        setMediaError(
          "Camera and microphone access is required for your virtual visit. Please allow access in your browser settings and refresh this page.",
        );
        setPhase("error");
        return;
      }

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const joinRes = await fetch(
        `${API_BASE}/visits/${encodeURIComponent(roomId)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, name: displayName }),
        },
      );
      if (!joinRes.ok) {
        setLoadError("Could not join the visit room.");
        setPhase("error");
        return;
      }

      const joinJson = (await joinRes.json()) as { joined_at?: string };
      const startedAt = joinJson.joined_at ?? info?.started_at;
      sessionStartRef.current = startedAt ? new Date(startedAt) : new Date();

      const SimplePeer = (await import("simple-peer")).default;
      const channel = supabase.channel(`visit:${roomId}`, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      const createPeer = (initiator: boolean) => {
        const peer = new SimplePeer({
          initiator,
          trickle: true,
          stream,
          config: {
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
          },
        });

        peer.on("signal", (data: SimplePeer.SignalData) => {
          const event =
            data.type === "offer"
              ? "offer"
              : data.type === "answer"
                ? "answer"
                : "ice-candidate";
          void channel.send({
            type: "broadcast",
            event,
            payload: data,
          });
        });

        peer.on("stream", (remoteStream: MediaStream) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
        });

        peer.on("connect", () => {
          setConnectionStatus("Connected");
        });

        peer.on("error", () => {
          setConnectionStatus("Connection error");
        });

        peerRef.current = peer;
      };

      channel.on("broadcast", { event: "offer" }, ({ payload }) => {
        if (role === "patient") {
          if (!peerRef.current) {
            createPeer(false);
          }
          peerRef.current?.signal(payload as SimplePeer.SignalData);
        }
      });

      channel.on("broadcast", { event: "answer" }, ({ payload }) => {
        if (role === "clinician") {
          peerRef.current?.signal(payload as SimplePeer.SignalData);
        }
      });

      channel.on("broadcast", { event: "ice-candidate" }, ({ payload }) => {
        peerRef.current?.signal(payload as SimplePeer.SignalData);
      });

      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR") reject(new Error("channel error"));
        });
      });

      if (role === "clinician") {
        createPeer(true);
      }

      setPhase("in_call");
      setConnectionStatus("Waiting for participant…");
    },
    [info?.started_at, roomId],
  );

  useEffect(() => {
    if (phase !== "connecting" || !participantName) return;
    const role = isClinician ? "clinician" : "patient";
    void setupWebRtc(participantName, role);
  }, [phase, participantName, isClinician, setupWebRtc]);

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    sessionStorage.setItem(nameStorageKey(roomId), trimmed);
    setParticipantName(trimmed);
    setPhase("connecting");
  }

  async function handleEndVisit() {
    if (!isClinician || !clinicIdParam) return;
    setEnding(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(
        `${API_BASE}/visits/${encodeURIComponent(roomId)}/end?clinic_id=${encodeURIComponent(clinicIdParam)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (res.ok) {
        const json = (await res.json()) as { duration_seconds?: number };
        setCompletedDuration(json.duration_seconds ?? elapsedSeconds);
        cleanupMedia();
        setPhase("completed");
      }
    } finally {
      setEnding(false);
    }
  }

  if (phase === "completed") {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
        style={{ background: PAGE_BG }}
      >
        <div className="max-w-lg rounded-2xl border border-teal-500/40 bg-[#0a1815]/90 px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div
            className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full text-teal-300"
            style={{ backgroundColor: `${TEAL}33` }}
          >
            <span className="text-3xl leading-none">✓</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
            Visit completed
          </h2>
          <p className="mt-3 text-sm text-teal-100/80">
            Duration: {formatDuration(completedDuration || elapsedSeconds)}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ background: PAGE_BG }}
      >
        <div className="max-w-md rounded-2xl border border-red-400/30 bg-[#0a1815]/90 px-6 py-8 text-center">
          <p className="text-sm text-red-200">{mediaError || loadError}</p>
        </div>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-6"
        style={{ background: PAGE_BG }}
      >
        <p className="text-teal-100/80">Loading visit…</p>
      </div>
    );
  }

  if (phase === "name") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-4 py-10"
        style={{ background: PAGE_BG }}
      >
        <div className="w-full max-w-md rounded-2xl border border-teal-500/30 bg-white/95 p-6 shadow-xl">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">
            {info?.clinic_name ?? "Virtual Visit"}
          </p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">
            {info?.clinician_name ?? "Your clinician"} is ready
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Enter your name to join the video visit.
          </p>
          <form onSubmit={handleNameSubmit} className="mt-5 space-y-3">
            <input
              type="text"
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
              placeholder="Your name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: TEAL }}
              disabled={!nameInput.trim()}
            >
              Join visit
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: PAGE_BG }}
    >
      <header className="border-b border-teal-900/50 px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs text-teal-200/70">{info?.clinic_name}</p>
            <p className="text-sm font-medium text-white">
              {info?.clinician_name}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-teal-100/80">
            <span>{participantName}</span>
            <span>{connectionStatus}</span>
            <span>{formatDuration(elapsedSeconds)}</span>
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col p-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/60 shadow-lg">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-3 right-3 h-24 w-32 rounded-lg border-2 border-teal-500/50 object-cover shadow-md sm:h-28 sm:w-40"
          />
        </div>

        {isClinician && clinicIdParam ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => void handleEndVisit()}
              disabled={ending}
              className="rounded-lg px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: TEAL }}
            >
              {ending ? "Ending…" : "End Visit"}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

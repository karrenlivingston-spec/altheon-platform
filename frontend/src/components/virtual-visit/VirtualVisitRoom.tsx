"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type SimplePeer from "simple-peer";

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";
const TEAL = "#0d9488";
const PAGE_BG = "linear-gradient(160deg, #0f2f2f 0%, #0b1f2d 100%)";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

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

type ParticipantRole = "clinician" | "patient";

function TranscriptStatusPill({
  status,
}: {
  status: "idle" | "recording" | "processing" | "complete" | "failed";
}) {
  const labels: Record<typeof status, string> = {
    idle: "Idle",
    recording: "Recording…",
    processing: "Processing…",
    complete: "Complete",
    failed: "Failed",
  };
  const styles: Record<typeof status, string> = {
    idle: "bg-slate-600/60 text-slate-200",
    recording: "bg-emerald-600/80 text-white animate-pulse",
    processing: "bg-amber-500/80 text-white",
    complete: "bg-emerald-600/80 text-white",
    failed: "bg-red-600/80 text-white",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${styles[status]}`}
    >
      Status: {labels[status]}
    </span>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function nameStorageKey(roomId: string): string {
  return `virtual_visit_name_${roomId}`;
}

function visitLog(roomId: string, message: string, detail?: unknown) {
  if (detail !== undefined) {
    console.log(`[VirtualVisit:${roomId}] ${message}`, detail);
  } else {
    console.log(`[VirtualVisit:${roomId}] ${message}`);
  }
}

function visitLogError(roomId: string, message: string, detail?: unknown) {
  if (detail !== undefined) {
    console.error(`[VirtualVisit:${roomId}] ${message}`, detail);
  } else {
    console.error(`[VirtualVisit:${roomId}] ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function acquireUserMedia(roomId: string): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    video: { facingMode: "user" },
    audio: { echoCancellation: true },
  };
  try {
    visitLog(roomId, "getUserMedia: requesting with constraints", constraints);
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (firstErr) {
    visitLogError(roomId, "getUserMedia: constrained request failed, retrying basic", firstErr);
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
}

function applyVp8Preference(peer: InstanceType<typeof SimplePeer>, roomId: string) {
  const pc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
  if (!pc || typeof pc.getTransceivers !== "function") return;

  try {
    const caps = RTCRtpSender.getCapabilities("video");
    if (!caps?.codecs?.length) return;
    const vp8 = caps.codecs.find((c) => c.mimeType.toLowerCase() === "video/vp8");
    if (!vp8) return;

    const ordered = [
      vp8,
      ...caps.codecs.filter((c) => c.mimeType.toLowerCase() !== "video/vp8"),
    ];

    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender.track?.kind === "video" && transceiver.setCodecPreferences) {
        transceiver.setCodecPreferences(ordered);
        visitLog(roomId, "VP8 codec preference applied on video transceiver");
      }
    }
  } catch (err) {
    visitLogError(roomId, "VP8 codec preference failed (non-fatal)", err);
  }
}

function attachStreamToVideo(
  el: HTMLVideoElement | null,
  stream: MediaStream,
  roomId: string,
  label: "local" | "remote",
) {
  if (!el) {
    visitLogError(roomId, `${label} video element ref not ready`);
    return;
  }
  el.srcObject = stream;
  void el.play().catch((err) => {
    visitLogError(roomId, `${label} video play() failed`, err);
  });
  visitLog(roomId, `${label} stream attached`, {
    streamId: stream.id,
    tracks: stream.getTracks().map((t) => `${t.kind}:${t.id}`),
  });
}

type VirtualVisitRoomProps = {
  roomId: string;
};

export default function VirtualVisitRoom({ roomId }: VirtualVisitRoomProps) {
  const searchParams = useSearchParams();
  const isClinician = searchParams.get("role") === "clinician";
  const clinicIdParam = searchParams.get("clinic_id") ?? "";
  const tokenParam = searchParams.get("token") ?? "";

  const getClinicianToken = useCallback(async (): Promise<string> => {
    if (tokenParam) return tokenParam;
    let {
      data: { session },
    } = await supabase.auth.getSession();
    let token = session?.access_token ?? "";
    if (!token) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      token = refreshed.session?.access_token ?? "";
    }
    return token;
  }, [tokenParam]);

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
  const [generatingSoap, setGeneratingSoap] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [transcriptStatus, setTranscriptStatus] = useState<
    "idle" | "recording" | "processing" | "complete" | "failed"
  >("idle");
  const [showTranscript, setShowTranscript] = useState(true);
  const [browserSupported] = useState(
    () => typeof window !== "undefined" && typeof window.RTCPeerConnection !== "undefined",
  );

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pendingRemoteStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const peerRef = useRef<InstanceType<typeof SimplePeer> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sessionStartRef = useRef<Date | null>(null);
  const pendingSignalsRef = useRef<SimplePeer.SignalData[]>([]);
  const remoteReadyRef = useRef(false);
  const localReadyRef = useRef(false);

  const stopRecordingMedia = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "inactive") {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // ignore
      }
    }
    mediaRecorderRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    stopRecordingMedia();
    setIsRecording(false);
    setTranscriptStatus((prev) => (prev === "recording" ? "processing" : prev));
  }, [stopRecordingMedia]);

  const startRecording = useCallback(async () => {
    const localStream = localStreamRef.current;
    const remoteStream = remoteStreamRef.current;
    if (!localStream || isRecording) return;

    try {
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const destination = audioContext.createMediaStreamDestination();

      if (localStream.getAudioTracks().length > 0) {
        const localSource = audioContext.createMediaStreamSource(localStream);
        localSource.connect(destination);
      }

      if (remoteStream?.getAudioTracks().length) {
        const remoteSource = audioContext.createMediaStreamSource(remoteStream);
        remoteSource.connect(destination);
      }

      const mixedStream = destination.stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(mixedStream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      const clinicianToken = await getClinicianToken();
      if (!clinicianToken) {
        visitLogError(roomId, "startRecording: missing auth token");
        void audioContext.close();
        audioContextRef.current = null;
        return;
      }

      const wsBase = API_BASE.replace("https://", "wss://").replace("http://", "ws://");
      const wsUrl = `${wsBase}/visits/${encodeURIComponent(roomId)}/transcribe?token=${encodeURIComponent(clinicianToken)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as {
            type?: string;
            full?: string;
          };
          if (data.type === "transcript_chunk" && data.full) {
            setTranscript(data.full);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        visitLogError(roomId, "transcription WebSocket error");
        setTranscriptStatus("failed");
        stopRecordingMedia();
        setIsRecording(false);
      };

      ws.onclose = () => {
        if (mediaRecorderRef.current?.state === "recording") {
          try {
            mediaRecorderRef.current.stop();
          } catch {
            // ignore
          }
        }
      };

      ws.onopen = () => {
        mediaRecorder.start(5000);
      };

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      setIsRecording(true);
      setTranscriptStatus("recording");
    } catch (err) {
      visitLogError(roomId, "Failed to start recording", err);
      stopRecordingMedia();
      setIsRecording(false);
      setTranscriptStatus("failed");
    }
  }, [getClinicianToken, isRecording, roomId, stopRecordingMedia]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    return () => {
      stopRecordingMedia();
    };
  }, [stopRecordingMedia]);

  const cleanupMedia = useCallback(() => {
    stopRecordingMedia();
    visitLog(roomId, "cleanupMedia");
    peerRef.current?.destroy();
    peerRef.current = null;
    pendingSignalsRef.current = [];
    remoteReadyRef.current = false;
    localReadyRef.current = false;
    pendingRemoteStreamRef.current = null;
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
  }, [roomId, stopRecordingMedia]);

  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  useEffect(() => {
    if (!browserSupported) {
      setLoadError(
        "Browser not supported — please use Chrome or Firefox for your virtual visit.",
      );
      setPhase("error");
    }
  }, [browserSupported]);

  useEffect(() => {
    if (pendingRemoteStreamRef.current && remoteVideoRef.current) {
      attachStreamToVideo(
        remoteVideoRef.current,
        pendingRemoteStreamRef.current,
        roomId,
        "remote",
      );
      pendingRemoteStreamRef.current = null;
    }
  }, [phase, roomId]);

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
    async (displayName: string, role: ParticipantRole) => {
      visitLog(roomId, `setupWebRtc start role=${role} name=${displayName}`);
      setConnectionStatus("Requesting camera and microphone…");

      let stream: MediaStream;
      try {
        stream = await acquireUserMedia(roomId);
      } catch (err) {
        visitLogError(roomId, "getUserMedia failed", err);
        setMediaError(
          "Camera and microphone access is required for your virtual visit. Please allow access in your browser settings and refresh this page.",
        );
        setPhase("error");
        return;
      }

      localStreamRef.current = stream;
      attachStreamToVideo(localVideoRef.current, stream, roomId, "local");

      const joinRes = await fetch(
        `${API_BASE}/visits/${encodeURIComponent(roomId)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, name: displayName }),
        },
      );
      if (!joinRes.ok) {
        visitLogError(roomId, "join endpoint failed", { status: joinRes.status });
        setLoadError("Could not join the visit room.");
        setPhase("error");
        return;
      }

      const joinJson = (await joinRes.json()) as { joined_at?: string };
      visitLog(roomId, "joined visit room", joinJson);
      const startedAt = joinJson.joined_at ?? info?.started_at;
      sessionStartRef.current = startedAt ? new Date(startedAt) : new Date();

      const SimplePeer = (await import("simple-peer")).default;
      const channel = supabase.channel(`visit:${roomId}`, {
        config: { broadcast: { self: false } },
      });
      channelRef.current = channel;

      const signalPeer = (data: SimplePeer.SignalData, source: string) => {
        if (!peerRef.current) {
          visitLog(roomId, `queueing signal from ${source} (peer not ready)`, data);
          pendingSignalsRef.current.push(data);
          return;
        }
        visitLog(roomId, `applying signal from ${source}`, data);
        peerRef.current.signal(data);
      };

      const attachRemoteStream = (remoteStream: MediaStream) => {
        visitLog(roomId, "peer stream event received", {
          streamId: remoteStream.id,
          tracks: remoteStream.getTracks().map((t) => `${t.kind}:${t.enabled}`),
        });
        remoteStreamRef.current = remoteStream;
        pendingRemoteStreamRef.current = remoteStream;
        attachStreamToVideo(remoteVideoRef.current, remoteStream, roomId, "remote");
        setConnectionStatus("Connected");
      };

      const createPeer = (initiator: boolean) => {
        visitLog(roomId, `creating simple-peer initiator=${initiator}`);
        const peer = new SimplePeer({
          initiator,
          trickle: true,
          stream,
          config: {
            iceServers: ICE_SERVERS,
            sdpSemantics: "unified-plan",
          } as RTCConfiguration,
        });

        applyVp8Preference(peer, roomId);

        peer.on("signal", (data: SimplePeer.SignalData) => {
          const event =
            data.type === "offer"
              ? "offer"
              : data.type === "answer"
                ? "answer"
                : "ice-candidate";
          visitLog(roomId, `local signal → broadcast ${event}`, data);
          void channel.send({
            type: "broadcast",
            event,
            payload: data,
          });
        });

        peer.on("stream", attachRemoteStream);

        peer.on("connect", () => {
          visitLog(roomId, "peer connect event");
          setConnectionStatus("Connected");
        });

        peer.on("close", () => {
          visitLog(roomId, "peer close event");
          setConnectionStatus("Disconnected");
        });

        peer.on("error", (err: Error) => {
          visitLogError(roomId, "peer error event", err);
          setConnectionStatus(`Connection error: ${err.message}`);
        });

        const pc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
        if (pc) {
          pc.onconnectionstatechange = () => {
            visitLog(roomId, `RTCPeerConnection state: ${pc.connectionState}`);
            if (pc.connectionState === "connected") {
              setConnectionStatus("Connected");
            } else if (pc.connectionState === "failed") {
              setConnectionStatus("Connection failed");
            }
          };
          pc.oniceconnectionstatechange = () => {
            visitLog(roomId, `ICE connection state: ${pc.iceConnectionState}`);
          };
          pc.onicegatheringstatechange = () => {
            visitLog(roomId, `ICE gathering state: ${pc.iceGatheringState}`);
          };
        }

        peerRef.current = peer;

        const queued = pendingSignalsRef.current.splice(0);
        if (queued.length) {
          visitLog(roomId, `flushing ${queued.length} queued signal(s)`);
          for (const data of queued) {
            peer.signal(data);
          }
        }
      };

      const maybeStartInitiator = () => {
        if (role !== "clinician" || peerRef.current) return;
        if (!remoteReadyRef.current) {
          visitLog(roomId, "clinician waiting for remote participant-ready");
          return;
        }
        visitLog(roomId, "clinician starting initiator peer");
        createPeer(true);
      };

      channel.on("broadcast", { event: "participant-ready" }, ({ payload }) => {
        const readyRole = (payload as { role?: ParticipantRole })?.role;
        visitLog(roomId, "participant-ready received", { readyRole, localRole: role });
        if (readyRole && readyRole !== role) {
          remoteReadyRef.current = true;
          maybeStartInitiator();
        }
      });

      channel.on("broadcast", { event: "offer" }, ({ payload }) => {
        visitLog(roomId, "offer received", { role });
        if (role === "patient") {
          if (!peerRef.current) {
            createPeer(false);
          }
          signalPeer(payload as SimplePeer.SignalData, "offer");
        }
      });

      channel.on("broadcast", { event: "answer" }, ({ payload }) => {
        visitLog(roomId, "answer received", { role });
        if (role === "clinician") {
          signalPeer(payload as SimplePeer.SignalData, "answer");
        }
      });

      channel.on("broadcast", { event: "ice-candidate" }, ({ payload }) => {
        visitLog(roomId, "ice-candidate received", payload);
        signalPeer(payload as SimplePeer.SignalData, "ice-candidate");
      });

      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status) => {
          visitLog(roomId, `realtime channel status: ${status}`);
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR") reject(new Error("channel error"));
          if (status === "TIMED_OUT") reject(new Error("channel subscribe timed out"));
        });
      });

      visitLog(roomId, "realtime channel subscribed, announcing participant-ready");
      localReadyRef.current = true;
      await channel.send({
        type: "broadcast",
        event: "participant-ready",
        payload: { role },
      });

      if (role === "clinician" && clinicIdParam) {
        // Signaling channel is live — tell the backend to send the patient SMS now.
        try {
          const token = await getClinicianToken();
          if (!token) {
            visitLogError(roomId, "ready: missing auth token, patient SMS not sent");
          } else {
            const readyRes = await fetch(
              `${API_BASE}/visits/${encodeURIComponent(roomId)}/ready?clinic_id=${encodeURIComponent(clinicIdParam)}`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
              },
            );
            const readyJson = (await readyRes.json().catch(() => ({}))) as {
              sms_sent?: boolean;
              already_sent?: boolean;
              detail?: string;
            };
            if (readyRes.ok) {
              visitLog(roomId, "ready: patient SMS triggered", readyJson);
            } else {
              visitLogError(roomId, "ready endpoint failed", {
                status: readyRes.status,
                detail: readyJson.detail,
              });
              setConnectionStatus("Could not send patient link. Retry from the calendar.");
            }
          }
        } catch (err) {
          visitLogError(roomId, "ready: unexpected error", err);
        }
      }

      if (role === "patient") {
        visitLog(roomId, "patient waiting for offer");
      } else {
        maybeStartInitiator();
      }

      setPhase("in_call");
      setConnectionStatus(
        role === "clinician" ? "Waiting for patient…" : "Waiting for clinician…",
      );
    },
    [info?.started_at, roomId, clinicIdParam, getClinicianToken],
  );

  useEffect(() => {
    if (phase !== "connecting" || !participantName) return;
    const role: ParticipantRole = isClinician ? "clinician" : "patient";
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
    let soapInProgress = false;
    try {
      const token = await getClinicianToken();

      if (!token) {
        visitLogError(roomId, "end visit: missing auth token — clinician must be signed in");
        setConnectionStatus("Could not end visit: please sign in and try again.");
        return;
      }

      visitLog(roomId, "end visit: sending request with auth token");

      const res = await fetch(
        `${API_BASE}/visits/${encodeURIComponent(roomId)}/end?clinic_id=${encodeURIComponent(clinicIdParam)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (res.ok) {
        const json = (await res.json()) as { duration_seconds?: number };
        visitLog(roomId, "end visit: success", json);
        setCompletedDuration(json.duration_seconds ?? elapsedSeconds);

        stopRecording();
        setTranscriptStatus("processing");
        soapInProgress = true;
        setGeneratingSoap(true);

        await sleep(3000);

        const soapRes = await fetch(
          `${API_BASE}/visits/${encodeURIComponent(roomId)}/generate-soap`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (soapRes.ok) {
          const soapData = (await soapRes.json()) as {
            appointment_id?: string;
          };
          setTranscriptStatus("complete");
          cleanupMedia();
          if (soapData.appointment_id) {
            window.location.href = `/admin/patients?appointment=${encodeURIComponent(soapData.appointment_id)}&tab=notes`;
            return;
          }
          setGeneratingSoap(false);
          setTranscriptStatus("failed");
          return;
        }

        visitLogError(roomId, "generate-soap failed", { status: soapRes.status });
        setTranscriptStatus("failed");
        setGeneratingSoap(false);
        return;
      }

      const errText = await res.text().catch(() => "");
      let errDetail = errText;
      try {
        const errJson = JSON.parse(errText) as { detail?: string };
        if (errJson.detail) errDetail = errJson.detail;
      } catch {
        // keep raw text
      }
      visitLogError(roomId, "end visit: request failed", {
        status: res.status,
        detail: errDetail,
      });
      setConnectionStatus(
        `Could not end visit (${res.status}): ${errDetail || "Unauthorized"}`,
      );
    } catch (err) {
      visitLogError(roomId, "end visit: unexpected error", err);
      if (soapInProgress) {
        setTranscriptStatus("failed");
        setGeneratingSoap(false);
      } else {
        setConnectionStatus("Could not end visit. Please try again.");
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
      className="flex h-[100dvh] flex-col overflow-hidden"
      style={{ background: PAGE_BG }}
    >
      <header className="shrink-0 border-b border-teal-900/50 px-4 py-3">
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

      <main className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden sm:p-4">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Mobile: remote ~80% of remaining viewport; desktop: 16:9 aspect box */}
          <div className="relative min-h-0 w-full flex-[4] overflow-hidden bg-black/60 sm:aspect-video sm:flex-none sm:rounded-xl sm:shadow-lg">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
            />
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute right-3 top-3 z-10 h-[160px] w-[120px] rounded-lg border-2 border-teal-500/50 object-cover shadow-md sm:bottom-3 sm:top-auto sm:h-28 sm:w-40"
            />
          </div>

          {isClinician && clinicIdParam && phase === "in_call" ? (
            <div className="mt-3 space-y-3 px-1 pb-3 sm:px-0">
              <div className="rounded-xl border border-teal-500/30 bg-[#0a1815]/80 px-4 py-3">
                <div className="flex flex-col gap-2">
                  {connectionStatus === "Connected" && !isRecording ? (
                    <button
                      type="button"
                      onClick={() => void startRecording()}
                      disabled={ending || generatingSoap}
                      className="min-h-[40px] w-fit rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      🎙 Start Recording
                    </button>
                  ) : null}
                  {isRecording ? (
                    <p className="text-xs text-gray-400">
                      Recording in progress — click End Visit when the session is complete.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <TranscriptStatusPill status={transcriptStatus} />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-teal-500/30 bg-[#0a1815]/80 px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-200/90">
                    Live Transcript
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowTranscript((v) => !v)}
                    className="text-xs font-medium text-teal-300 hover:text-teal-100"
                  >
                    {showTranscript ? "Hide" : "Show"}
                  </button>
                </div>

                {transcriptStatus === "failed" ? (
                  <p className="mb-2 rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                    Transcription failed — you can still document manually
                  </p>
                ) : null}

                {showTranscript ? (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-teal-900/60 bg-black/30 px-3 py-2 text-sm leading-relaxed text-teal-50/90">
                    {transcript.trim() ? (
                      <p className="whitespace-pre-wrap">{transcript}</p>
                    ) : (
                      <p className="text-teal-200/50 italic">
                        Transcript will appear here once recording starts…
                      </p>
                    )}
                    <div ref={transcriptEndRef} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {isClinician && clinicIdParam ? (
          <div
            className="sticky bottom-0 z-20 shrink-0 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] sm:rounded-b-xl"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void handleEndVisit()}
                disabled={ending || generatingSoap}
                className="min-h-[44px] w-full max-w-md rounded-lg px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                style={{ backgroundColor: TEAL }}
              >
                {ending || generatingSoap ? "Ending…" : "End Visit"}
              </button>
            </div>
          </div>
        ) : null}

        {generatingSoap && isClinician ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-6">
            <div className="w-full max-w-sm rounded-2xl bg-white px-8 py-10 text-center shadow-xl">
              <p className="text-3xl leading-none">⚙️</p>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">
                Generating your SOAP note
              </h2>
              <p className="mt-2 text-sm text-slate-600">Please wait…</p>
              <div className="mx-auto mt-6 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-[#0d9488]" />
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

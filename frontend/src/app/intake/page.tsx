"use client";

import Image from "next/image";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { useEffect, useState } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "elevenlabs-convai": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { "agent-id": string },
        HTMLElement
      >;
    }
  }
}

export default function IntakePage() {
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://elevenlabs.io/convai-widget/index.js";
    script.async = true;
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      console.log("[intake] window message:", e.data, {
        origin: e.origin,
      });

      if (
        e.data?.type === "conversation-end" ||
        e.data?.type === "call_ended" ||
        e.data?.source === "elevenlabs"
      ) {
        console.log("[intake] postMessage received:", e.data);
        setComplete(true);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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

        <div className="mt-10 flex w-full justify-center">
          <elevenlabs-convai
            {...{ "agent-id": "agent_8201kr28yvzqfws937kzq7tkdb93" }}
          />
        </div>
      </div>
    </div>
  );
}

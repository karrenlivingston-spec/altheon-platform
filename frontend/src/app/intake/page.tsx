"use client";

import Image from "next/image";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { useEffect } from "react";

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
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://elevenlabs.io/convai-widget/index.js";
    script.async = true;
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);

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
          {/* Hyphenated attribute: use spread so JSX does not parse `agent-id` as subtraction */}
          <elevenlabs-convai
            {...{ "agent-id": "agent_8201kr28yvzqfws937kzq7tkdb93" }}
          />
        </div>
      </div>
    </div>
  );
}

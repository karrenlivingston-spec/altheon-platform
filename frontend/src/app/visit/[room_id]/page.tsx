"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import VirtualVisitRoom from "@/components/virtual-visit/VirtualVisitRoom";

function VisitRoomInner() {
  const params = useParams();
  const roomId =
    typeof params.room_id === "string" ? params.room_id.trim() : "";
  return <VirtualVisitRoom roomId={roomId} />;
}

export default function VirtualVisitPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex h-[100dvh] items-center justify-center px-6"
          style={{
            background:
              "linear-gradient(160deg, #0f2f2f 0%, #0b1f2d 100%)",
          }}
        >
          <p className="text-teal-100/80">Loading visit…</p>
        </div>
      }
    >
      <VisitRoomInner />
    </Suspense>
  );
}

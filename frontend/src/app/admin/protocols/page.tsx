"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProtocolsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/performance-center?tab=research");
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-500">
      Redirecting to Performance Center…
    </div>
  );
}

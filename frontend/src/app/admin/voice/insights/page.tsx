"use client";

import Link from "next/link";
import { Bot, Sparkles } from "lucide-react";

import {
  DS_CARD,
  DS_PAGE_ROOT,
  DS_PAGE_SUBTITLE,
  DS_PAGE_TITLE,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";

export default function VoiceInsightsPage() {
  return (
    <div className={DS_PAGE_ROOT}>
      <div className="mb-6">
        <Link
          href="/admin/voice"
          className="text-sm font-medium text-[#0D9488] hover:text-[#0f766e]"
        >
          ← Voice Agent
        </Link>
      </div>

      <div className={`${DS_CARD} mx-auto max-w-2xl py-16 text-center`}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-[#0D9488]">
          <Sparkles className="h-7 w-7" aria-hidden />
        </div>
        <h1 className={DS_PAGE_TITLE}>Insights coming soon</h1>
        <p className={`${DS_PAGE_SUBTITLE} mx-auto mt-3 max-w-md`}>
          AI-powered analysis of call patterns, patient sentiment, and Aria
          performance recommendations.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Bot className="h-4 w-4" aria-hidden />
          <span>Aria intelligence layer</span>
        </div>
        <Link href="/admin/voice" className={`${DS_SECONDARY_BTN} mt-8 inline-flex`}>
          Back to Voice Agent
        </Link>
      </div>
    </div>
  );
}

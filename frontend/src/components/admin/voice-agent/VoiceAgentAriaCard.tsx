"use client";

import { AudioLines } from "lucide-react";

type VoiceAgentAriaCardProps = {
  isOnline?: boolean;
};

export default function VoiceAgentAriaCard({ isOnline = true }: VoiceAgentAriaCardProps) {
  return (
    <div className="flex h-full min-h-[120px] flex-col justify-between rounded-xl bg-gray-900 p-5 text-white shadow-sm lg:col-span-2">
      <div className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gray-800">
          <AudioLines className="h-7 w-7 text-green-400" aria-hidden />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-lg font-bold">Aria</p>
            <span className="flex items-center gap-1.5 text-xs font-medium text-green-400">
              <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
              Online
            </span>
          </div>
          <p className="text-sm text-gray-400">AI Receptionist</p>
        </div>
      </div>
      <div className="mt-4">
        <p className="text-sm font-medium text-gray-200">24/7 patient communication</p>
        <p className="text-xs text-gray-500">Always here. Always helping.</p>
      </div>
      {!isOnline ? (
        <p className="mt-2 text-xs text-amber-400">Agent offline</p>
      ) : null}
    </div>
  );
}

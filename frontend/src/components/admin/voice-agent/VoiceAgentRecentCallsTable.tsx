"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Copy,
  ExternalLink,
  MoreHorizontal,
  Play,
  User,
  FileText,
} from "lucide-react";

import {
  DS_TABLE_HEAD,
  DS_TABLE_WRAP,
  DS_TD_PRIMARY,
  DS_TD_SECONDARY,
  DS_TH,
  DS_TR,
} from "@/app/admin/designSystem";
import {
  RecentCall,
  outcomeBadgeClass,
} from "@/components/admin/voice-agent/voiceAgentTypes";

type VoiceAgentRecentCallsTableProps = {
  calls: RecentCall[];
  loading?: boolean;
};

export default function VoiceAgentRecentCallsTable({
  calls,
  loading,
}: VoiceAgentRecentCallsTableProps) {
  const router = useRouter();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [transcriptCall, setTranscriptCall] = useState<RecentCall | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const copySid = useCallback(async (sid: string) => {
    try {
      await navigator.clipboard.writeText(sid);
    } catch {
      /* ignore */
    }
    setMenuId(null);
  }, []);

  return (
    <>
      <div id="recent-calls" className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Recent Calls</h3>
          <p className="text-xs text-gray-500">Last 20 inbound calls</p>
        </div>
        <div className={DS_TABLE_WRAP}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className={DS_TABLE_HEAD}>
                <tr>
                  <th className={DS_TH}>Time</th>
                  <th className={DS_TH}>Caller</th>
                  <th className={DS_TH}>Phone Number</th>
                  <th className={DS_TH}>Duration</th>
                  <th className={DS_TH}>Outcome</th>
                  <th className={DS_TH}>Appointment</th>
                  <th className={DS_TH}>Summary</th>
                  <th className={DS_TH}>Recording</th>
                  <th className={`${DS_TH} w-10`} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                      Loading…
                    </td>
                  </tr>
                ) : calls.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                      No call records found
                    </td>
                  </tr>
                ) : (
                  calls.map((row) => {
                    const appt =
                      row.appointment_time && row.appointment_clinician
                        ? `${row.appointment_time} / ${row.appointment_clinician}`
                        : row.appointment_time ?? "—";
                    return (
                      <tr key={row.id} className={DS_TR}>
                        <td className={`${DS_TD_PRIMARY} whitespace-nowrap`}>
                          {row.time}
                        </td>
                        <td className={DS_TD_PRIMARY}>{row.caller_name}</td>
                        <td className={`${DS_TD_SECONDARY} whitespace-nowrap`}>
                          {row.caller_phone}
                        </td>
                        <td className={DS_TD_PRIMARY}>{row.duration}</td>
                        <td className={DS_TD_PRIMARY}>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${outcomeBadgeClass(row.outcome)}`}
                          >
                            {row.outcome_label}
                          </span>
                        </td>
                        <td className={`${DS_TD_SECONDARY} max-w-[180px] truncate`}>
                          {appt}
                        </td>
                        <td
                          className={`max-w-[160px] truncate ${DS_TD_SECONDARY}`}
                          title={row.summary}
                        >
                          {row.summary}
                        </td>
                        <td className={DS_TD_PRIMARY}>
                          {row.recording_url ? (
                            <a
                              href={row.recording_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-50"
                              aria-label="Play recording"
                            >
                              <Play className="h-4 w-4" />
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="relative px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              setMenuId(menuId === row.id ? null : row.id)
                            }
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            aria-label="Actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {menuId === row.id ? (
                            <div
                              ref={menuRef}
                              className="absolute right-2 top-10 z-20 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                            >
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                onClick={() => {
                                  setTranscriptCall(row);
                                  setMenuId(null);
                                }}
                              >
                                <FileText className="h-4 w-4" />
                                View Transcript
                              </button>
                              {row.patient_id ? (
                                <Link
                                  href={`/admin/patients/${row.patient_id}`}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => setMenuId(null)}
                                >
                                  <User className="h-4 w-4" />
                                  View Patient
                                </Link>
                              ) : null}
                              {row.call_sid ? (
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                  onClick={() => void copySid(row.call_sid!)}
                                >
                                  <Copy className="h-4 w-4" />
                                  Copy Call SID
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={() => router.push("/admin/voice/calls")}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            View All Calls →
          </button>
        </div>
      </div>

      {transcriptCall ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transcript-title"
        >
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 id="transcript-title" className="font-semibold text-gray-900">
                  Call Transcript
                </h2>
                <p className="text-sm text-gray-500">
                  {transcriptCall.caller_name} · {transcriptCall.time}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTranscriptCall(null)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                Close
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {transcriptCall.transcript?.trim() || "No transcript available."}
              </p>
            </div>
            {transcriptCall.recording_url ? (
              <div className="border-t border-gray-100 px-5 py-3">
                <a
                  href={transcriptCall.recording_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open recording
                </a>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

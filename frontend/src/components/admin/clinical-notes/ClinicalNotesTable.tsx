"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, Eye, Loader2, MoreHorizontal } from "lucide-react";

import { DS_TABLE_HEAD, DS_TABLE_WRAP, DS_TD_PRIMARY, DS_TH, DS_TR } from "@/app/admin/designSystem";
import {
  ClinicalNoteListItem,
  formatNoteDateTime,
  noteTypeLabel,
  patientInitials,
} from "@/components/admin/clinical-notes/clinicalNotesTypes";

type ClinicalNotesTableProps = {
  notes: ClinicalNoteListItem[];
  loading?: boolean;
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onView: (note: ClinicalNoteListItem) => void;
  onEdit: (note: ClinicalNoteListItem) => void;
  onDownloadPdf: (note: ClinicalNoteListItem) => void;
  onReview?: (note: ClinicalNoteListItem) => void;
  exportingNoteId?: string | null;
  canEdit: (note: ClinicalNoteListItem) => boolean;
  scopeReview?: boolean;
};

function badge(base: string, text: string) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${base}`}>
      {text}
    </span>
  );
}

export default function ClinicalNotesTable({
  notes,
  loading,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onView,
  onEdit,
  onDownloadPdf,
  onReview,
  exportingNoteId,
  canEdit,
  scopeReview,
}: ClinicalNotesTableProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuId) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuId(null);
      }
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuId]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div>
      <div className={DS_TABLE_WRAP}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className={DS_TABLE_HEAD}>
              <tr>
                <th className={DS_TH}>Patient</th>
                <th className={DS_TH}>Visit Date</th>
                <th className={DS_TH}>Type</th>
                <th className={DS_TH}>Provider</th>
                <th className={DS_TH}>AI Status</th>
                <th className={DS_TH}>Review Status</th>
                <th className={DS_TH}>Signature</th>
                <th className={DS_TH}>Attorney</th>
                <th className={DS_TH}>Created</th>
                <th className={`${DS_TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : notes.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-gray-500">
                    No notes match your filters.
                  </td>
                </tr>
              ) : (
                notes.map((n) => {
                  const name = n.patient_name?.trim() || "—";
                  const visit = formatNoteDateTime(n.visit_date);
                  const created = formatNoteDateTime(n.created_at);
                  const pending = (n.status ?? "").toLowerCase() === "ai_review_pending";
                  return (
                    <tr key={n.id} className={DS_TR}>
                      <td className={DS_TD_PRIMARY}>
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
                            {patientInitials(name)}
                          </span>
                          <div>
                            <p className="font-medium text-gray-900">{name}</p>
                            <p className="text-xs text-gray-500">{n.patient_pt_id || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <p>{visit.date}</p>
                        {visit.time ? <p className="text-xs text-gray-500">{visit.time}</p> : null}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <p>{noteTypeLabel(n.note_type)}</p>
                        {n.body_region ? (
                          <p className="text-xs text-gray-500">{n.body_region}</p>
                        ) : null}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {n.clinician_name?.trim() || n.author_name?.trim() || "—"}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <span className="inline-flex items-center gap-1.5">
                          {pending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                          ) : null}
                          {n.ai_generated
                            ? badge("bg-green-50 text-green-700", "AI Generated")
                            : badge("bg-gray-100 text-gray-600", "Not Generated")}
                        </span>
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {n.review_status === "reviewed"
                          ? badge("border border-green-200 bg-white text-green-700", "Reviewed")
                          : n.review_status === "needs_review"
                            ? badge("bg-amber-50 text-amber-800", "Needs Review")
                            : "—"}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {n.signature_status === "signed"
                          ? badge("bg-green-50 text-green-700", "Signed")
                          : badge("bg-gray-100 text-gray-600", "Not Signed")}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        {n.attorney_requested && n.attorney_request_date
                          ? formatNoteDateTime(n.attorney_request_date).date
                          : "—"}
                      </td>
                      <td className={DS_TD_PRIMARY}>
                        <p>{created.date}</p>
                        {created.time ? (
                          <p className="text-xs text-gray-500">{created.time}</p>
                        ) : null}
                      </td>
                      <td className={`${DS_TD_PRIMARY} relative text-right`}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onView(n)}
                            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                            aria-label="View note"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {scopeReview && onReview ? (
                            <button
                              type="button"
                              onClick={() => onReview(n)}
                              className="rounded-lg bg-[var(--color-primary,#16A34A)] px-3 py-1.5 text-xs font-medium text-white"
                            >
                              Review
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setMenuId(menuId === n.id ? null : n.id)}
                              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                              aria-label="More actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        {menuId === n.id ? (
                          <div
                            ref={menuRef}
                            className="absolute right-6 top-10 z-20 min-w-[168px] rounded-lg border border-gray-200 bg-white py-1 text-left shadow-lg"
                          >
                            {canEdit(n) ? (
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
                                onClick={() => {
                                  setMenuId(null);
                                  onEdit(n);
                                }}
                              >
                                Edit
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
                              onClick={() => {
                                setMenuId(null);
                                onDownloadPdf(n);
                              }}
                            >
                              {exportingNoteId === n.id ? "Downloading…" : "Download PDF"}
                            </button>
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-sm text-gray-400"
                              disabled
                            >
                              Request Attorney
                            </button>
                            <button
                              type="button"
                              className="block w-full px-3 py-2 text-sm text-gray-400"
                              disabled
                            >
                              Delete
                            </button>
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

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Showing {from} to {to} of {totalCount} notes
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-gray-200 px-2 py-1"
            >
              {[10, 25, 50].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRight,
  MoreHorizontal,
  Pencil,
} from "lucide-react";

import {
  LegalRequest,
  daysOpen,
  formatRequestDate,
  nextStatus,
  patientPtId,
  prevStatus,
  requestTypeLabel,
} from "@/components/admin/legal-requests/legalRequestsTypes";

type LegalRequestCardProps = {
  request: LegalRequest;
  onEdit: (request: LegalRequest) => void;
  onMoveForward: (request: LegalRequest) => void;
  onMoveBack: (request: LegalRequest) => void;
  onArchive: (request: LegalRequest) => void;
  dragging?: boolean;
};

function badge(base: string, text: string) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${base}`}>
      {text}
    </span>
  );
}

export default function LegalRequestCard({
  request,
  onEdit,
  onMoveForward,
  onMoveBack,
  onArchive,
  dragging,
}: LegalRequestCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: request.id,
    data: { request },
  });

  useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const name = request.patient_name?.trim() || "—";
  const ptId = patientPtId(request.patient_id);
  const openDays = daysOpen(request.request_date);
  const requested = request.documents_requested?.length ?? 0;
  const prepared = request.documents_prepared?.length ?? 0;
  const canForward = !!nextStatus(request.status);
  const canBack = !!prevStatus(request.status);
  const source = (request.source ?? "manual").toLowerCase();
  const daysClass =
    openDays > 30
      ? "text-red-600 font-semibold"
      : openDays > 14
        ? "text-amber-600 font-medium"
        : "text-gray-500";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${
        isDragging || dragging ? "opacity-60 ring-2 ring-emerald-400/40" : ""
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{name}</p>
          {ptId ? <p className="text-[11px] text-gray-500">{ptId}</p> : null}
        </div>
        {badge("bg-gray-100 text-gray-700", requestTypeLabel(request.request_type))}
      </div>

      <p className="mt-2 text-xs text-gray-600">
        {[request.attorney_name, request.firm_name].filter(Boolean).join(" · ") ||
          request.requesting_party_name ||
          "—"}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-gray-500">
          {formatRequestDate(request.request_date)}
        </span>
        <span className={daysClass}>{openDays}d open</span>
        {source === "ai"
          ? badge("bg-purple-50 text-purple-700", "AI")
          : badge("bg-gray-100 text-gray-600", "Manual")}
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between text-[11px] text-gray-500">
          <span>Documents</span>
          <span>
            {prepared} of {requested || "—"} prepared
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-1.5 rounded-full bg-emerald-500"
            style={{
              width: `${requested ? Math.min(100, (prepared / requested) * 100) : 0}%`,
            }}
          />
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-end gap-1 border-t border-gray-100 pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(request);
          }}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          aria-label="Edit request"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={!canForward}
          onClick={(e) => {
            e.stopPropagation();
            onMoveForward(request);
          }}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-emerald-700 disabled:opacity-30"
          aria-label="Move forward"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
          aria-label="More actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {menuOpen ? (
          <div
            ref={menuRef}
            className="absolute right-0 top-9 z-20 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={!canBack}
              className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50 disabled:text-gray-300"
              onClick={() => {
                setMenuOpen(false);
                onMoveBack(request);
              }}
            >
              Move Back
            </button>
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                setMenuOpen(false);
                onArchive(request);
              }}
            >
              Archive
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

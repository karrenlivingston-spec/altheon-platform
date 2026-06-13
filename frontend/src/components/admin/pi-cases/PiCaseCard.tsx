"use client";

import { useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, MoreHorizontal, Pencil } from "lucide-react";

import {
  KANBAN_COLUMNS,
  PiCaseBoardItem,
  formatUsd,
  nextStatus,
  prevStatus,
  statusTagLabel,
} from "@/components/admin/pi-cases/piCasesTypes";

type PiCaseCardProps = {
  item: PiCaseBoardItem;
  onEdit: (item: PiCaseBoardItem) => void;
  onMoveForward: (item: PiCaseBoardItem) => void;
  onMoveBack: (item: PiCaseBoardItem) => void;
  onArchive: (item: PiCaseBoardItem) => void;
  dragging?: boolean;
};

function columnBorder(status: string): string {
  return (
    KANBAN_COLUMNS.find((c) => c.id === status)?.border ?? "border-l-gray-300"
  );
}

export default function PiCaseCard({
  item,
  onEdit,
  onMoveForward,
  onMoveBack,
  onArchive,
  dragging,
}: PiCaseCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { item },
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

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const canForward = !!nextStatus(item.status);
  const canBack = !!prevStatus(item.status);

  let dueLabel = "";
  if (item.records_due_date) {
    if (item.is_overdue) {
      dueLabel = `${item.days_overdue ?? 0} days overdue`;
    } else {
      const due = new Date(`${item.records_due_date}T12:00:00`);
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
      dueLabel = days >= 0 ? `Due in ${days} days` : `${Math.abs(days)} days overdue`;
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-lg border border-gray-200 border-l-4 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${columnBorder(item.status)} ${
        isDragging || dragging ? "opacity-60 ring-2 ring-emerald-400/40" : ""
      }`}
      {...listeners}
      {...attributes}
    >
      {item.is_overdue ? (
        <span className="absolute right-2 top-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800">
          Overdue
        </span>
      ) : null}
      {item.attorney_request_pending && !item.is_overdue ? (
        <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          Pending
        </span>
      ) : null}

      <div className="flex items-start justify-between gap-2 pr-16">
        <p className="font-semibold text-gray-900">{item.patient_name}</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded p-1 text-gray-400 hover:bg-gray-100"
          aria-label="Actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-1 text-xs text-gray-500">{item.insurance_carrier || "—"}</p>
      {item.firm_name ? (
        <p className="text-xs text-gray-600">Atty: {item.firm_name}</p>
      ) : null}
      {item.date_of_accident ? (
        <p className="text-xs text-gray-500">DOI: {item.date_of_accident}</p>
      ) : null}
      {dueLabel ? (
        <p
          className={`mt-1 text-xs font-medium ${
            item.is_overdue ? "text-red-600" : "text-amber-600"
          }`}
        >
          {dueLabel}
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-700">
          {statusTagLabel(item)}
        </span>
        {item.estimated_settlement ? (
          <span className="text-[10px] text-gray-500">
            {formatUsd(item.estimated_settlement)}
          </span>
        ) : null}
      </div>

      {menuOpen ? (
        <div
          ref={menuRef}
          className="absolute right-2 top-10 z-20 min-w-[148px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => {
              setMenuOpen(false);
              onEdit(item);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            type="button"
            disabled={!canForward}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 disabled:text-gray-300"
            onClick={() => {
              setMenuOpen(false);
              onMoveForward(item);
            }}
          >
            <ArrowRight className="h-3.5 w-3.5" /> Move Forward
          </button>
          <button
            type="button"
            disabled={!canBack}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:text-gray-300"
            onClick={() => {
              setMenuOpen(false);
              onMoveBack(item);
            }}
          >
            Move Back
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            onClick={() => {
              setMenuOpen(false);
              onArchive(item);
            }}
          >
            Archive
          </button>
        </div>
      ) : null}
    </div>
  );
}

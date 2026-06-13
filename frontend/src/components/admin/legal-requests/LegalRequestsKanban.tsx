"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import LegalRequestCard from "@/components/admin/legal-requests/LegalRequestCard";
import {
  COLUMN_ACCENT,
  KANBAN_COLUMNS,
  LegalRequest,
  LegalRequestStatus,
} from "@/components/admin/legal-requests/legalRequestsTypes";

type LegalRequestsKanbanProps = {
  requests: LegalRequest[];
  onEdit: (request: LegalRequest) => void;
  onMove: (requestId: string, status: LegalRequestStatus) => void;
  onMoveForward: (request: LegalRequest) => void;
  onMoveBack: (request: LegalRequest) => void;
  onArchive: (request: LegalRequest) => void;
};

function KanbanColumn({
  columnId,
  label,
  accent,
  count,
  children,
}: {
  columnId: string;
  label: string;
  accent: (typeof KANBAN_COLUMNS)[number]["accent"];
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const colors = COLUMN_ACCENT[accent];

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[500px] min-w-[280px] flex-1 flex-col rounded-xl bg-[#f9fafb] p-3 ${
        isOver ? "ring-2 ring-emerald-400/50" : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={`text-sm font-bold ${colors.header}`}>{label}</h3>
        <span
          className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${colors.badge}`}
        >
          {count}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

export default function LegalRequestsKanban({
  requests,
  onEdit,
  onMove,
  onMoveForward,
  onMoveBack,
  onArchive,
}: LegalRequestsKanbanProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const byStatus = useMemo(() => {
    const map: Record<string, LegalRequest[]> = {};
    for (const col of KANBAN_COLUMNS) {
      map[col.id] = [];
    }
    for (const r of requests) {
      const st = (r.status ?? "received").toLowerCase();
      if (map[st]) map[st].push(r);
    }
    return map;
  }, [requests]);

  const activeRequest = activeId
    ? requests.find((r) => r.id === activeId) ?? null
    : null;

  function handleDragStart(ev: DragStartEvent) {
    setActiveId(String(ev.active.id));
  }

  function handleDragEnd(ev: DragEndEvent) {
    setActiveId(null);
    const requestId = String(ev.active.id);
    const overId = ev.over ? String(ev.over.id) : null;
    if (!overId) return;
    const valid = KANBAN_COLUMNS.some((c) => c.id === overId);
    if (!valid) return;
    const req = requests.find((r) => r.id === requestId);
    if (!req || (req.status ?? "received") === overId) return;
    onMove(requestId, overId as LegalRequestStatus);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {KANBAN_COLUMNS.map((col) => {
            const items = byStatus[col.id] ?? [];
            return (
              <KanbanColumn
                key={col.id}
                columnId={col.id}
                label={col.label}
                accent={col.accent}
                count={items.length}
              >
                {items.length === 0 ? (
                  <p className="py-8 text-center text-xs text-gray-400">No requests</p>
                ) : (
                  items.map((req) => (
                    <LegalRequestCard
                      key={req.id}
                      request={req}
                      onEdit={onEdit}
                      onMoveForward={onMoveForward}
                      onMoveBack={onMoveBack}
                      onArchive={onArchive}
                    />
                  ))
                )}
              </KanbanColumn>
            );
          })}
        </div>
      </div>

      <DragOverlay>
        {activeRequest ? (
          <LegalRequestCard
            request={activeRequest}
            onEdit={() => {}}
            onMoveForward={() => {}}
            onMoveBack={() => {}}
            onArchive={() => {}}
            dragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

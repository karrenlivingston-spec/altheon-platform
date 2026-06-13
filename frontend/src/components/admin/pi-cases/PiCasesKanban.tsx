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

import PiCaseCard from "@/components/admin/pi-cases/PiCaseCard";
import {
  COLUMN_HEADER,
  KANBAN_COLUMNS,
  PiCaseBoard,
  PiCaseBoardItem,
  PiCaseStatus,
  formatUsd,
} from "@/components/admin/pi-cases/piCasesTypes";

type PiCasesKanbanProps = {
  board: PiCaseBoard | null;
  onEdit: (item: PiCaseBoardItem) => void;
  onMove: (id: string, status: PiCaseStatus) => void;
  onMoveForward: (item: PiCaseBoardItem) => void;
  onMoveBack: (item: PiCaseBoardItem) => void;
  onArchive: (item: PiCaseBoardItem) => void;
  onAddCase: (status: PiCaseStatus) => void;
};

function KanbanColumn({
  columnId,
  label,
  accent,
  count,
  estValue,
  children,
}: {
  columnId: string;
  label: string;
  accent: (typeof KANBAN_COLUMNS)[number]["accent"];
  count: number;
  estValue: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const colors = COLUMN_HEADER[accent];

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[500px] min-w-[260px] flex-1 flex-col rounded-xl bg-[#f9fafb] p-3 ${
        isOver ? "ring-2 ring-emerald-400/50" : ""
      }`}
    >
      <div className="mb-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className={`text-sm font-bold ${colors.text}`}>{label}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colors.badge}`}
          >
            {count}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">Est. Value {formatUsd(estValue)}</p>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">{children}</div>
    </div>
  );
}

export default function PiCasesKanban({
  board,
  onEdit,
  onMove,
  onMoveForward,
  onMoveBack,
  onArchive,
  onAddCase,
}: PiCasesKanbanProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const allItems = useMemo(() => {
    if (!board) return [];
    return KANBAN_COLUMNS.flatMap((c) => board[c.id] ?? []);
  }, [board]);

  const activeItem = activeId
    ? allItems.find((i) => i.id === activeId) ?? null
    : null;

  function handleDragStart(ev: DragStartEvent) {
    setActiveId(String(ev.active.id));
  }

  function handleDragEnd(ev: DragEndEvent) {
    setActiveId(null);
    const id = String(ev.active.id);
    const overId = ev.over ? String(ev.over.id) : null;
    if (!overId) return;
    if (!KANBAN_COLUMNS.some((c) => c.id === overId)) return;
    const item = allItems.find((i) => i.id === id);
    if (!item || item.status === overId) return;
    onMove(id, overId as PiCaseStatus);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-4">
          {KANBAN_COLUMNS.map((col) => {
            const items = board?.[col.id] ?? [];
            const estValue = items.reduce(
              (s, i) => s + (Number(i.estimated_settlement) || 0),
              0,
            );
            return (
              <KanbanColumn
                key={col.id}
                columnId={col.id}
                label={col.label}
                accent={col.accent}
                count={items.length}
                estValue={estValue}
              >
                {items.length === 0 ? (
                  <p className="py-8 text-center text-xs text-gray-400">No cases</p>
                ) : (
                  items.map((item) => (
                    <PiCaseCard
                      key={item.id}
                      item={item}
                      onEdit={onEdit}
                      onMoveForward={onMoveForward}
                      onMoveBack={onMoveBack}
                      onArchive={onArchive}
                    />
                  ))
                )}
                <button
                  type="button"
                  onClick={() => onAddCase(col.id)}
                  className="mt-1 rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-500 hover:border-emerald-400 hover:text-emerald-700"
                >
                  + Add Case
                </button>
              </KanbanColumn>
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {activeItem ? (
          <PiCaseCard
            item={activeItem}
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

"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";

import { DS_INPUT } from "@/app/admin/designSystem";

import type { HEPExerciseDraft } from "@/components/admin/patients/hepTypes";

const FIELD_INPUT = `h-9 ${DS_INPUT}`;

type HEPExerciseRowProps = {
  exercise: HEPExerciseDraft;
  onChange: (patch: Partial<HEPExerciseDraft>) => void;
  onRemove: () => void;
};

export default function HEPExerciseRow({
  exercise,
  onChange,
  onRemove,
}: HEPExerciseRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: exercise.library_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border border-gray-100 bg-gray-50/60 p-3 ${
        isDragging ? "z-10 opacity-90 shadow-md" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1 shrink-0 cursor-grab touch-none rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-gray-900">
              {exercise.name || "Exercise"}
            </p>
            <button
              type="button"
              onClick={onRemove}
              className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Remove exercise"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <label className="block text-xs text-gray-500">
              Sets
              <input
                type="number"
                min={0}
                className={`mt-1 w-full ${FIELD_INPUT}`}
                value={exercise.sets}
                onChange={(e) => onChange({ sets: e.target.value })}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Reps
              <input
                type="number"
                min={0}
                className={`mt-1 w-full ${FIELD_INPUT}`}
                value={exercise.reps}
                onChange={(e) => onChange({ reps: e.target.value })}
              />
            </label>
            <label className="block text-xs text-gray-500">
              Hold (s)
              <input
                type="number"
                min={0}
                className={`mt-1 w-full ${FIELD_INPUT}`}
                value={exercise.hold_seconds}
                onChange={(e) => onChange({ hold_seconds: e.target.value })}
              />
            </label>
            <label className="block text-xs text-gray-500 sm:col-span-2 lg:col-span-1">
              Freq
              <input
                className={`mt-1 w-full ${FIELD_INPUT}`}
                value={exercise.frequency}
                onChange={(e) => onChange({ frequency: e.target.value })}
                placeholder="3x per day"
              />
            </label>
            <label className="block text-xs text-gray-500 sm:col-span-2 lg:col-span-2 xl:col-span-2">
              Notes
              <input
                className={`mt-1 w-full ${FIELD_INPUT}`}
                value={exercise.notes}
                onChange={(e) => onChange({ notes: e.target.value })}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

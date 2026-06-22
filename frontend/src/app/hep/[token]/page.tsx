"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

const BRAND_BLUE = "#1D4ED8";

type HEPExercise = {
  name?: string | null;
  sets?: number | null;
  reps?: number | null;
  hold_seconds?: number | null;
  frequency?: string | null;
  notes?: string | null;
  video_url?: string | null;
};

type HEPPublicProgram = {
  id: string;
  title?: string | null;
  exercises?: HEPExercise[] | null;
  created_at?: string | null;
  clinics?: { name?: string | null; brand_name?: string | null } | null;
};

type LoadStatus = "loading" | "ready" | "not_found" | "error";

function exerciseMetaPills(exercise: HEPExercise): string[] {
  const pills: string[] = [];
  if (exercise.sets != null) {
    pills.push(`${exercise.sets} ${exercise.sets === 1 ? "Set" : "Sets"}`);
  }
  if (exercise.reps != null) {
    pills.push(`${exercise.reps} ${exercise.reps === 1 ? "Rep" : "Reps"}`);
  }
  if (exercise.hold_seconds != null) {
    pills.push(`${exercise.hold_seconds} sec hold`);
  }
  return pills;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 h-5 w-2/3 rounded bg-slate-200" />
      <div className="mb-4 flex gap-2">
        <div className="h-6 w-16 rounded-full bg-slate-100" />
        <div className="h-6 w-16 rounded-full bg-slate-100" />
      </div>
      <div className="h-4 w-full rounded bg-slate-100" />
    </div>
  );
}

export default function HepPublicPage() {
  const params = useParams();
  const token = typeof params.token === "string" ? params.token.trim() : "";

  const [status, setStatus] = useState<LoadStatus>("loading");
  const [program, setProgram] = useState<HEPPublicProgram | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("not_found");
      return;
    }
    let cancelled = false;
    void (async () => {
      setStatus("loading");
      try {
        const res = await fetch(
          `${API_BASE}/hep/public/${encodeURIComponent(token)}`,
        );
        if (cancelled) return;
        if (res.status === 404) {
          setStatus("not_found");
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const json = (await res.json()) as HEPPublicProgram;
        setProgram(json);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-lg space-y-6">
          <div className="space-y-2">
            <div className="h-7 w-24 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
          </div>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (status === "not_found" || status === "error" || !program) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <p className="text-lg font-medium text-slate-900">
            This link is invalid or has expired.
          </p>
        </div>
      </div>
    );
  }

  const clinicName =
    (program.clinics?.brand_name ?? "").trim() ||
    (program.clinics?.name ?? "").trim() ||
    null;
  const exercises = Array.isArray(program.exercises) ? program.exercises : [];
  const title = (program.title ?? "").trim() || "Home Exercise Program";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-lg space-y-6">
        <header className="space-y-1 border-b border-slate-200 pb-6">
          <p
            className="text-xl font-bold tracking-tight"
            style={{ color: BRAND_BLUE }}
          >
            Altheon
          </p>
          {clinicName ? (
            <p className="text-sm text-slate-600">{clinicName}</p>
          ) : null}
        </header>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {title}
          </h1>
          <p className="mt-2 text-base text-slate-600">
            Your Home Exercise Program
          </p>
        </div>

        <div className="space-y-4">
          {exercises.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
              No exercises in this program yet.
            </div>
          ) : (
            exercises.map((exercise, index) => {
              const name =
                (exercise.name ?? "").trim() || `Exercise ${index + 1}`;
              const pills = exerciseMetaPills(exercise);
              const frequency = (exercise.frequency ?? "").trim();
              const notes = (exercise.notes ?? "").trim();
              const videoUrl = (exercise.video_url ?? "").trim();
              return (
                <article
                  key={`${name}-${index}`}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <h2 className="text-lg font-bold text-slate-900">{name}</h2>
                  {pills.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pills.map((pill) => (
                        <span
                          key={pill}
                          className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800"
                        >
                          {pill}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {frequency ? (
                    <p className="mt-3 text-sm font-medium text-slate-700">
                      {frequency}
                    </p>
                  ) : null}
                  {notes ? (
                    <p className="mt-2 text-sm text-slate-500">{notes}</p>
                  ) : null}
                  {videoUrl ? (
                    <a
                      href={videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-block text-sm font-semibold text-blue-700 hover:text-blue-800"
                    >
                      Watch Video →
                    </a>
                  ) : null}
                </article>
              );
            })
          )}
        </div>

        <footer className="border-t border-slate-200 pt-6 text-center text-xs text-slate-500">
          Provided by your care team via Altheon
        </footer>
      </div>
    </div>
  );
}

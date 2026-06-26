"use client";

export const BODY_REGION_OPTIONS = [
  { value: "cervical", label: "Cervical (Neck)" },
  { value: "lumbar", label: "Lumbar (Low Back)" },
  { value: "shoulder", label: "Shoulder" },
  { value: "elbow", label: "Elbow" },
  { value: "wrist", label: "Wrist / Hand" },
  { value: "hip", label: "Hip" },
  { value: "knee", label: "Knee" },
  { value: "ankle", label: "Ankle / Foot" },
  { value: "other", label: "Other" },
] as const;

export type BodyRegionValue = (typeof BODY_REGION_OPTIONS)[number]["value"];

const VALID_VALUES = new Set<string>(BODY_REGION_OPTIONS.map((o) => o.value));

/** Map API/scribe strings to a selector value (or "" if unset). */
export function normalizeBodyRegion(
  raw: string | null | undefined,
): BodyRegionValue | "" {
  const br = (raw ?? "").trim().toLowerCase();
  if (!br) return "";
  if (VALID_VALUES.has(br)) return br as BodyRegionValue;
  if (br.includes("lumbar") || br.includes("low back")) return "lumbar";
  if (br.includes("cervical") || br.includes("neck")) return "cervical";
  if (br.includes("shoulder")) return "shoulder";
  if (br.includes("elbow")) return "elbow";
  if (br.includes("wrist") || br.includes("hand")) return "wrist";
  if (br.includes("hip")) return "hip";
  if (br.includes("knee")) return "knee";
  if (br.includes("ankle") || br.includes("foot")) return "ankle";
  return "other";
}

type BodyRegionSelectorProps = {
  value: string;
  onChange: (value: BodyRegionValue | "") => void;
};

export function BodyRegionSelector({ value, onChange }: BodyRegionSelectorProps) {
  const selected = normalizeBodyRegion(value);

  return (
    <div>
      <p className="text-sm font-medium text-gray-700">
        Body region{" "}
        <span className="font-normal text-gray-500">(optional)</span>
      </p>
      <div
        className="mt-2 grid grid-cols-3 gap-2"
        role="group"
        aria-label="Body region"
      >
        {BODY_REGION_OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange(isSelected ? "" : opt.value)}
              className={`min-h-[44px] rounded-full px-2 py-2 text-xs font-medium leading-tight transition-colors ${
                isSelected
                  ? "bg-[var(--color-primary,#16A34A)] text-white shadow-sm"
                  : "border border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

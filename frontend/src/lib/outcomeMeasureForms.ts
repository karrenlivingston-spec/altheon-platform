export type OutcomeFormType = "ndi" | "odi" | "quickdash";

export type OutcomeQuestion = {
  id: string;
  text: string;
};

export const NDI_OPTIONS = [
  { value: 0, label: "No disability" },
  { value: 1, label: "Mild disability" },
  { value: 2, label: "Moderate disability" },
  { value: 3, label: "Severe disability" },
  { value: 4, label: "Very severe disability" },
  { value: 5, label: "Complete disability" },
] as const;

export const ODI_OPTIONS = NDI_OPTIONS;

export const QUICKDASH_OPTIONS = [
  { value: 1, label: "No difficulty" },
  { value: 2, label: "Mild difficulty" },
  { value: 3, label: "Moderate difficulty" },
  { value: 4, label: "Severe difficulty" },
  { value: 5, label: "Unable" },
] as const;

export const NDI_QUESTIONS: OutcomeQuestion[] = [
  { id: "pain", text: "Pain Intensity" },
  { id: "personal_care", text: "Personal Care (washing, dressing, etc.)" },
  { id: "lifting", text: "Lifting" },
  { id: "reading", text: "Reading" },
  { id: "headaches", text: "Headaches" },
  { id: "concentration", text: "Concentration" },
  { id: "work", text: "Work" },
  { id: "driving", text: "Driving" },
  { id: "sleeping", text: "Sleeping" },
  { id: "recreation", text: "Recreation" },
];

export const ODI_QUESTIONS: OutcomeQuestion[] = [
  { id: "pain", text: "Pain Intensity" },
  { id: "personal_care", text: "Personal Care (washing, dressing, etc.)" },
  { id: "lifting", text: "Lifting" },
  { id: "walking", text: "Walking" },
  { id: "sitting", text: "Sitting" },
  { id: "standing", text: "Standing" },
  { id: "sleeping", text: "Sleeping" },
  { id: "sex_life", text: "Sex Life (if applicable)" },
  { id: "social_life", text: "Social Life" },
  { id: "travelling", text: "Travelling" },
];

export const QUICKDASH_QUESTIONS: OutcomeQuestion[] = [
  { id: "q1", text: "Open a tight or new jar" },
  { id: "q2", text: "Write" },
  { id: "q3", text: "Turn a key" },
  { id: "q4", text: "Prepare a meal" },
  { id: "q5", text: "Push open a heavy door" },
  { id: "q6", text: "Place an object on a shelf above your head" },
  { id: "q7", text: "Do heavy household chores" },
  { id: "q8", text: "Garden or do yard work" },
  { id: "q9", text: "Carry a shopping bag or briefcase" },
  { id: "q10", text: "Carry a heavy object (over 10 lbs / 4.5 kg)" },
  { id: "q11", text: "Change a lightbulb overhead" },
];

export function formTypeLabel(formType: string): string {
  switch (formType) {
    case "ndi":
      return "NDI — Neck";
    case "odi":
      return "ODI — Low Back";
    case "quickdash":
      return "QuickDASH — Arm/Shoulder";
    default:
      return formType.toUpperCase();
  }
}

export function formTypeTitle(formType: string): string {
  switch (formType) {
    case "ndi":
      return "Neck Disability Index (NDI)";
    case "odi":
      return "Oswestry Disability Index (ODI)";
    case "quickdash":
      return "QuickDASH";
    default:
      return "Outcome Measure";
  }
}

export function getFormConfig(formType: OutcomeFormType) {
  switch (formType) {
    case "ndi":
      return { questions: NDI_QUESTIONS, options: NDI_OPTIONS };
    case "odi":
      return { questions: ODI_QUESTIONS, options: ODI_OPTIONS };
    case "quickdash":
      return { questions: QUICKDASH_QUESTIONS, options: QUICKDASH_OPTIONS };
  }
}

export function interpretationColorClass(interpretation: string): string {
  const s = interpretation.toLowerCase();
  if (
    s.includes("no disability") ||
    s.includes("minimal") ||
    s === "mild" ||
    s.includes("mild disability")
  ) {
    return "text-green-700 bg-green-50 border-green-200";
  }
  if (s.includes("moderate")) {
    return "text-amber-800 bg-amber-50 border-amber-200";
  }
  return "text-red-800 bg-red-50 border-red-200";
}

import { supabase } from "@/lib/supabase";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type PossibleDuplicateMatch = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
};

export type CreatedPatient = {
  id: string;
  first_name: string;
  last_name: string;
  [key: string]: unknown;
};

export type CreatePatientResult =
  | { kind: "created"; patient: CreatedPatient }
  | { kind: "possible_duplicate"; matches: PossibleDuplicateMatch[] }
  | { kind: "error"; message: string };

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function parseDuplicateMatches(value: unknown): PossibleDuplicateMatch[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      id: String(row.id ?? ""),
      first_name: String(row.first_name ?? "").trim(),
      last_name: String(row.last_name ?? "").trim(),
      date_of_birth:
        row.date_of_birth == null || row.date_of_birth === ""
          ? null
          : String(row.date_of_birth).slice(0, 10),
    }))
    .filter((row) => row.id);
}

export async function postCreatePatient(
  body: Record<string, unknown>,
  confirmDuplicate = false,
): Promise<CreatePatientResult> {
  try {
    const payload = { ...body, confirm_duplicate: confirmDuplicate };
    const res = await fetch(`${API_BASE}/patients`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(payload),
    });
    const json: unknown = await res.json().catch(() => ({}));

    if (
      res.ok &&
      json &&
      typeof json === "object" &&
      "status" in json &&
      (json as { status: unknown }).status === "possible_duplicate"
    ) {
      return {
        kind: "possible_duplicate",
        matches: parseDuplicateMatches(
          (json as { matches?: unknown }).matches,
        ),
      };
    }

    if (!res.ok) {
      const detail =
        json &&
        typeof json === "object" &&
        "detail" in json &&
        typeof (json as { detail: unknown }).detail === "string"
          ? (json as { detail: string }).detail
          : `Error ${res.status}`;
      return { kind: "error", message: detail };
    }

    if (
      !json ||
      typeof json !== "object" ||
      !("id" in json) ||
      typeof (json as { id: unknown }).id !== "string"
    ) {
      return { kind: "error", message: "Patient created but response was invalid." };
    }

    return { kind: "created", patient: json as CreatedPatient };
  } catch {
    return { kind: "error", message: "Could not create patient. Please try again." };
  }
}

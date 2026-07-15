import { supabase } from "@/lib/supabase";

export const PI_CASES_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export async function piCasesAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export function piCasesApiUrl(path: string, params?: URLSearchParams): string {
  const base = `${PI_CASES_API_BASE}/api/pi-cases${path}`;
  if (!params || [...params.keys()].length === 0) return base;
  return `${base}?${params}`;
}

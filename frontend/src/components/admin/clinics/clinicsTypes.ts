export const VITALITY_CLINIC_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

export type ClinicsDashboardStats = {
  total_clinics: number;
  active_clinics: number;
  inactive_clinics: number;
  total_patients: number;
  patients_vs_last_month: number;
  appointments_mtd: number;
  appointments_vs_last_month: number;
  collected_mtd: number;
  collected_vs_last_month: number;
  avg_collection_rate_pct: number;
};

export type CollectionTrendPoint = {
  date: string;
  amount: number;
};

export type ClinicCardData = {
  id: string;
  name: string;
  brand_name: string | null;
  slug?: string | null;
  address: string;
  location_city: string | null;
  location_state: string | null;
  status: string;
  billing_model: string;
  agent_name: string;
  agent_status: string;
  elevenlabs_agent_id: string | null;
  logo_url: string | null;
  primary_color: string;
  patient_count: number;
  appointments_mtd: number;
  collected_mtd: number;
  collection_rate_pct: number;
  no_show_rate_pct: number;
  agent_success_rate_pct: number;
  collections_trend: CollectionTrendPoint[];
};

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function pctTrend(delta: number): { text: string; positive: boolean } {
  if (delta > 0) return { text: `↑ ${delta}% vs last month`, positive: true };
  if (delta < 0) return { text: `↓ ${Math.abs(delta)}% vs last month`, positive: false };
  return { text: "→ 0% vs last month", positive: true };
}

export function collectionBarColor(pct: number): string {
  if (pct > 85) return "bg-green-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-red-500";
}

export function noShowBarColor(pct: number): string {
  if (pct < 3) return "bg-green-500";
  if (pct <= 5) return "bg-amber-500";
  return "bg-red-500";
}

export function displayBillingModel(raw: string): string {
  const s = raw.toLowerCase();
  if (s === "cash") return "Cash";
  if (s === "insurance") return "Insurance";
  if (s === "hybrid") return "Hybrid";
  return raw;
}

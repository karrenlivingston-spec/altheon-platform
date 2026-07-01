import { supabase } from "@/lib/supabaseClient";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://altheon-platform.onrender.com";

export type StaffTask = {
  id: string;
  clinic_id?: string;
  title: string;
  description?: string | null;
  priority: string;
  source: string;
  status: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  patient_id?: string | null;
  patient_name?: string | null;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type TaskNotification = {
  id: string;
  clinic_id: string;
  user_id: string;
  task_id: string;
  notification_type: string;
  read_at?: string | null;
  created_at?: string | null;
};

export type StaffMember = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
  role?: string | null;
};

export type ConversationParticipant = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
};

export type ConversationSummary = {
  id: string;
  clinic_id: string;
  type: string;
  created_at?: string | null;
  participants?: ConversationParticipant[];
  last_message?: {
    content?: string | null;
    sender_id?: string | null;
    sender_name?: string | null;
    created_at?: string | null;
  } | null;
  unread_count: number;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name?: string | null;
  sender_first_name?: string | null;
  sender_last_name?: string | null;
  content: string;
  created_at?: string | null;
};

export type PatientOption = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
};

export async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function getCurrentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export function staffDisplayName(
  member: Pick<StaffMember, "first_name" | "last_name"> | null | undefined,
): string {
  if (!member) return "—";
  const combined = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();
  return combined || "—";
}

export function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function notificationTypeLabel(type: string): string {
  switch (type) {
    case "task_created":
      return "New task";
    case "task_acknowledged":
      return "Acknowledged";
    case "task_resolved":
      return "Resolved";
    default:
      return type.replace(/_/g, " ");
  }
}

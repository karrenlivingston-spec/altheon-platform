"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, X } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useClinic } from "@/app/admin/ClinicContext";
import {
  DS_CARD,
  DS_INPUT,
  DS_PAGE_ROOT,
  DS_PRIMARY_BTN,
  DS_SECONDARY_BTN,
} from "@/app/admin/designSystem";
import {
  API_BASE,
  authHeaders,
  formatMessageTime,
  getCurrentUserId,
  staffDisplayName,
  type ChatMessage,
  type ConversationSummary,
  type StaffMember,
} from "@/lib/tasksMessaging";
import { supabase } from "@/lib/supabaseClient";

function conversationLabel(conv: ConversationSummary, currentUserId: string): string {
  if (conv.type === "clinic_wide") return "# Staff Chat";
  const other = conv.participants?.find((p) => p.user_id !== currentUserId);
  return other ? staffDisplayName(other) : "Direct Message";
}

type NewDMModalProps = {
  open: boolean;
  clinicId: string;
  userId: string;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
};

function NewDMModal({ open, clinicId, userId, onClose, onCreated }: NewDMModalProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId("");
    setError(null);
    if (!clinicId) return;

    let cancelled = false;
    (async () => {
      setLoadingStaff(true);
      try {
        const res = await fetch(`${API_BASE}/messaging/${encodeURIComponent(clinicId)}/staff`, {
          headers: await authHeaders(),
        });
        const json = res.ok ? await res.json() : [];
        if (!cancelled) {
          setStaff(Array.isArray(json) ? (json as StaffMember[]) : []);
        }
      } catch {
        if (!cancelled) setStaff([]);
      } finally {
        if (!cancelled) setLoadingStaff(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, clinicId]);

  if (!open) return null;

  const others = staff.filter((s) => s.user_id !== userId);

  async function startDm() {
    if (!selectedId) {
      setError("Select a staff member");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/messaging/${encodeURIComponent(clinicId)}/conversations/dm`,
        {
          method: "POST",
          headers: await authHeaders(true),
          body: JSON.stringify({
            participant_user_ids: [userId, selectedId],
          }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Failed to start conversation");
      }
      const conv = (await res.json()) as ConversationSummary;
      onCreated(conv.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start conversation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">New Direct Message</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>
        <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto">
          {loadingStaff ? (
            <li className="px-3 py-4 text-center text-sm text-gray-500">Loading staff…</li>
          ) : others.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-gray-500">No staff available</li>
          ) : null}
          {others.map((s) => (
            <li key={s.user_id}>
              <button
                type="button"
                onClick={() => setSelectedId(s.user_id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  selectedId === s.user_id
                    ? "bg-teal-50 text-teal-900 ring-1 ring-teal-200"
                    : "hover:bg-gray-50"
                }`}
              >
                <MessageCircle className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="font-medium">{staffDisplayName(s)}</span>
                {s.role ? (
                  <span className="ml-auto text-xs capitalize text-gray-400">{s.role}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={DS_SECONDARY_BTN} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={DS_PRIMARY_BTN}
            disabled={submitting}
            onClick={() => void startDm()}
          >
            {submitting ? "Starting…" : "Start Chat"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MessagingPageContent() {
  const { clinicId, me } = useClinic();
  const userId = me?.user_id ?? "";
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userDeselectedRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (feedRef.current) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    });
  }, []);

  const loadConversations = useCallback(async () => {
    if (!clinicId || !userId) return;
    setLoadingConversations(true);
    try {
      const [convRes, staffRes] = await Promise.all([
        fetch(
          `${API_BASE}/messaging/${encodeURIComponent(clinicId)}/conversations?user_id=${encodeURIComponent(userId)}`,
          { headers: await authHeaders() },
        ),
        fetch(`${API_BASE}/messaging/${encodeURIComponent(clinicId)}/staff`, {
          headers: await authHeaders(),
        }),
      ]);
      const convJson = convRes.ok ? await convRes.json() : [];
      const staffJson = staffRes.ok ? await staffRes.json() : [];
      const convs = Array.isArray(convJson) ? (convJson as ConversationSummary[]) : [];
      setConversations(convs);
      setStaff(Array.isArray(staffJson) ? staffJson : []);
      setActiveId((prev) => {
        if (prev) return prev;
        if (userDeselectedRef.current) return null;
        return convs[0]?.id ?? null;
      });
    } catch {
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [clinicId, userId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!clinicId || !userId) return;
      setLoadingMessages(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/messaging/${encodeURIComponent(clinicId)}/conversations/${encodeURIComponent(conversationId)}/messages?user_id=${encodeURIComponent(userId)}`,
          { headers: await authHeaders() },
        );
        if (!res.ok) throw new Error("Could not load messages");
        const rows = (await res.json()) as ChatMessage[];
        setMessages(Array.isArray(rows) ? rows : []);
        scrollToBottom();
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load messages");
        setMessages([]);
      } finally {
        setLoadingMessages(false);
      }
    },
    [clinicId, userId, scrollToBottom],
  );

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeId);
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (!activeId) return;

    const channel = supabase
      .channel(`messages:${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeId}`,
        },
        (payload) => {
          const row = payload.new as ChatMessage;
          const sender = staff.find((s) => s.user_id === row.sender_id);
          const enriched: ChatMessage = {
            ...row,
            sender_name: sender ? staffDisplayName(sender) : row.sender_name,
            sender_first_name: sender?.first_name ?? row.sender_first_name,
            sender_last_name: sender?.last_name ?? row.sender_last_name,
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === enriched.id)) return prev;
            return [...prev, enriched];
          });
          scrollToBottom();
          if (row.sender_id !== userId) {
            void loadConversations();
          }
        },
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [activeId, userId, scrollToBottom, loadConversations, staff]);

  async function sendMessage() {
    if (!activeId || !clinicId || !userId || !messageText.trim()) return;
    setSending(true);
    setError(null);
    try {
      const uid = userId || (await getCurrentUserId());
      if (!uid) throw new Error("Not authenticated");

      const res = await fetch(
        `${API_BASE}/messaging/${encodeURIComponent(clinicId)}/conversations/${encodeURIComponent(activeId)}/messages`,
        {
          method: "POST",
          headers: await authHeaders(true),
          body: JSON.stringify({ sender_id: uid, content: messageText.trim() }),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Failed to send message");
      }
      const created = (await res.json()) as ChatMessage;
      setMessages((prev) => {
        if (prev.some((m) => m.id === created.id)) return prev;
        return [...prev, created];
      });
      setMessageText("");
      scrollToBottom();
      void loadConversations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className={DS_PAGE_ROOT}>
      <div className={`${DS_CARD} flex min-h-[calc(100vh-12rem)] overflow-hidden !p-0`}>
        <aside className="flex w-full flex-col border-r border-gray-200 md:w-1/3">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
            <h1 className="text-lg font-semibold text-gray-900">Messages</h1>
            <button type="button" className={DS_SECONDARY_BTN} onClick={() => setDmOpen(true)}>
              New DM
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingConversations ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500">Loading…</p>
            ) : conversations.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500">No conversations yet</p>
            ) : (
              <ul>
                {conversations.map((conv) => {
                  const label = conversationLabel(conv, userId);
                  const active = conv.id === activeId;
                  const unread = conv.unread_count > 0;
                  return (
                    <li key={conv.id}>
                      <button
                        type="button"
                        onClick={() => {
                          userDeselectedRef.current = false;
                          setActiveId(conv.id);
                        }}
                        className={`flex w-full flex-col gap-1 border-b border-gray-100 px-4 py-3 text-left transition-colors ${
                          active
                            ? "border-l-4 border-l-teal-600 bg-teal-50/80"
                            : unread
                              ? "bg-gray-50 hover:bg-gray-100"
                              : "hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate text-sm ${unread ? "font-bold text-gray-900" : "font-medium text-gray-800"}`}
                          >
                            {label}
                          </span>
                          {unread ? (
                            <span className="shrink-0 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold text-white">
                              {conv.unread_count}
                            </span>
                          ) : null}
                        </div>
                        {conv.last_message?.content ? (
                          <p className="line-clamp-1 text-xs text-gray-500">
                            {conv.last_message.sender_name
                              ? `${conv.last_message.sender_name}: `
                              : ""}
                            {conv.last_message.content}
                          </p>
                        ) : null}
                        {conv.last_message?.created_at ? (
                          <p className="text-[10px] text-gray-400">
                            {formatMessageTime(conv.last_message.created_at)}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-[24rem] flex-1 flex-col md:w-2/3">
          {activeConversation ? (
            <>
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <h2 className="font-semibold text-gray-900">
                  {conversationLabel(activeConversation, userId)}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    userDeselectedRef.current = true;
                    setActiveId(null);
                  }}
                  aria-label="Close conversation"
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div ref={feedRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
                {loadingMessages ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-12 text-center text-sm text-gray-500">
                    No messages yet. Say hello!
                  </p>
                ) : (
                  messages.map((msg) => {
                    const own = msg.sender_id === userId;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${own ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                            own ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-900"
                          }`}
                        >
                          {!own ? (
                            <p className="mb-0.5 text-xs font-bold opacity-80">
                              {msg.sender_name ||
                                staffDisplayName({
                                  first_name: msg.sender_first_name,
                                  last_name: msg.sender_last_name,
                                })}
                            </p>
                          ) : null}
                          <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                        </div>
                        <span className="mt-1 text-[10px] text-gray-400">
                          {formatMessageTime(msg.created_at)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
              {error ? (
                <p className="px-6 pb-2 text-sm text-red-600">{error}</p>
              ) : null}
              <div className="flex gap-2 border-t border-gray-100 px-6 py-4">
                <input
                  className={DS_INPUT}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Type a message…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  className={DS_PRIMARY_BTN}
                  disabled={sending || !messageText.trim()}
                  onClick={() => void sendMessage()}
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
              Select a conversation
            </div>
          )}
        </section>
      </div>

      <NewDMModal
        open={dmOpen}
        clinicId={clinicId}
        userId={userId}
        onClose={() => setDmOpen(false)}
        onCreated={(id) => {
          userDeselectedRef.current = false;
          setActiveId(id);
          void loadConversations();
        }}
      />
    </div>
  );
}

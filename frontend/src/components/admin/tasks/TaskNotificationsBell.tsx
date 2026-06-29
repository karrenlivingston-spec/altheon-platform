"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

import {
  API_BASE,
  authHeaders,
  formatTimeAgo,
  notificationTypeLabel,
  type StaffTask,
  type TaskNotification,
} from "@/lib/tasksMessaging";

type TaskNotificationsBellProps = {
  clinicId: string;
  userId: string | null | undefined;
};

export default function TaskNotificationsBell({
  clinicId,
  userId,
}: TaskNotificationsBellProps) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!clinicId || !userId) {
      setUnreadCount(0);
      setNotifications([]);
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/tasks/${encodeURIComponent(clinicId)}/notifications?user_id=${encodeURIComponent(userId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setUnreadCount(0);
        setNotifications([]);
        return;
      }
      const json = (await res.json()) as {
        unread_count?: number;
        notifications?: TaskNotification[];
      };
      setUnreadCount(json.unread_count ?? 0);
      setNotifications(Array.isArray(json.notifications) ? json.notifications : []);
    } catch {
      setUnreadCount(0);
      setNotifications([]);
    }
  }, [clinicId, userId]);

  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(() => void loadNotifications(), 60000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useEffect(() => {
    if (!open || notifications.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/tasks/${encodeURIComponent(clinicId)}?status=all`,
          { headers: await authHeaders() },
        );
        if (!res.ok || cancelled) return;
        const tasks = (await res.json()) as StaffTask[];
        const map: Record<string, string> = {};
        for (const t of tasks) {
          if (t.id) map[t.id] = t.title;
        }
        if (!cancelled) setTaskTitles(map);
      } catch {
        if (!cancelled) setTaskTitles({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, notifications.length, clinicId]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function handleToggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!clinicId || !userId) return;
    try {
      await fetch(
        `${API_BASE}/tasks/${encodeURIComponent(clinicId)}/notifications/mark-read`,
        {
          method: "POST",
          headers: await authHeaders(true),
          body: JSON.stringify({ user_id: userId }),
        },
      );
      setUnreadCount(0);
    } catch {
      /* ignore */
    }
    void loadNotifications();
  }

  if (!userId) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => void handleToggle()}
        className="relative rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
        aria-label="Task notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-gray-200 bg-white py-2 shadow-lg">
          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Notifications
          </p>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">No unread notifications</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className="border-t border-gray-100 px-4 py-3 text-sm first:border-t-0"
                >
                  <p className="font-medium text-gray-900">
                    {taskTitles[n.task_id] || "Task update"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {notificationTypeLabel(n.notification_type)}
                    {n.created_at ? ` · ${formatTimeAgo(n.created_at)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

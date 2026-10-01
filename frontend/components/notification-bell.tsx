"use client";
import Link from "next/link";
import { useId } from "react";
import { Bell } from "lucide-react";
import { getNotifications } from "@/lib/notifications";
import { useApiResource } from "./use-api-resource";

export function NotificationBell() {
  const notifications = useApiResource(getNotifications);
  const descriptionId = useId();
  const unread =
    notifications.error === undefined &&
    notifications.data?.some((notification) => notification.readAt === null);
  const description =
    notifications.error !== undefined
      ? "알림 상태를 확인하지 못했어요"
      : unread
        ? "읽지 않은 알림이 있어요"
        : undefined;
  return (
    <Link
      className="icon-button notification-bell"
      href="/account/notifications"
      aria-label="알림"
      aria-describedby={description ? descriptionId : undefined}
    >
      <Bell size={24} aria-hidden="true" />
      {unread && (
        <span className="notification-unread-dot" aria-hidden="true" />
      )}
      {description && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}
    </Link>
  );
}

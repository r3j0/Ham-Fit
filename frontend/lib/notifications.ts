import { api } from "./session";
import { invalid, object, timestamp, uuid } from "./api-contract";
import { readPages } from "./groups";
export interface GroupNotification {
  id: string;
  groupId: string;
  requestId: string;
  type: "join_requested" | "join_approved" | "join_rejected";
  createdAt: string;
  readAt: string | null;
}
export function parseNotification(value: unknown): GroupNotification {
  const row = object(value);
  if (
    ![row.id, row.groupId, row.requestId].every(uuid) ||
    !["join_requested", "join_approved", "join_rejected"].includes(
      String(row.type),
    ) ||
    !timestamp(row.createdAt) ||
    !(row.readAt === null || timestamp(row.readAt))
  )
    invalid();
  return row as unknown as GroupNotification;
}
export const getNotifications = (signal?: AbortSignal) =>
  readPages("/notifications", parseNotification, signal).then((rows) =>
    rows.sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    ),
  );
export const readNotification = (id: string) =>
  api<unknown>(`/notifications/${id}/read`, {
    method: "PATCH",
    headers: { "X-CSRF-Protection": "1" },
  }).then(({ data }) => {
    const row = parseNotification(data);
    if (row.id !== id || row.readAt === null) invalid();
    return row;
  });

"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getNotifications, readNotification } from "@/lib/notifications";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { useOperationScope } from "./use-operation-scope";
import { Header, Loading, Notice, Shell } from "./ui";
import styles from "./notifications.module.css";
const labels = {
  join_requested: "새 그룹 가입 신청이 도착했어요.",
  join_approved: "그룹 가입이 승인됐어요.",
  join_rejected: "그룹 가입 신청이 거절됐어요.",
};
export function Notifications() {
  const resource = useApiResource(getNotifications, {
      refreshIntervalMs: 60000,
      staleTimeMs: 60000,
    }),
    begin = useOperationScope(),
    guard = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const unread = resource.data?.filter(
    (row) => row.readAt === null && !dismissed.has(row.id),
  );
  async function read(id: string) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    const current = begin();
    try {
      await readNotification(id);
      if (current()) {
        setDismissed((previous) => new Set(previous).add(id));
        resource.reload();
      }
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      if (current()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <Shell>
      <Header
        title="알림"
        back="/"
        right={
          <button
            className="icon-button"
            aria-label="알림 새로고침"
            title="알림 새로고침"
            onClick={resource.reload}
            disabled={resource.loading || busy}
          >
            <RefreshCw size={22} aria-hidden="true" />
          </button>
        }
      />
      <div className="content stack">
        {error && <Notice>{error}</Notice>}
        {resource.error !== undefined ? (
          <>
            <Notice>{errorMessage(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              알림 다시 불러오기
            </button>
          </>
        ) : resource.data ? (
          <>
            <ul className={styles.list} aria-label="그룹 알림">
              {unread?.map((row) => (
                <li key={row.id} className={styles.card}>
                  <h2>{labels[row.type]}</h2>
                  <time className={styles.meta} dateTime={row.createdAt}>
                    {new Date(row.createdAt).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </time>
                  <div className={styles.actions}>
                    <Link
                      className="button secondary"
                      href={
                        row.type === "join_rejected"
                          ? "/groups"
                          : `/groups/${row.groupId}`
                      }
                    >
                      {row.type === "join_requested"
                        ? "가입 신청 확인"
                        : row.type === "join_approved"
                          ? "그룹 보기"
                          : "내 그룹 보기"}
                    </Link>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void read(row.id)}
                    >
                      읽음으로 표시
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {!unread?.length && (
              <p className="muted" role="status">
                새 그룹 알림이 없어요.
              </p>
            )}
          </>
        ) : (
          <Loading />
        )}
      </div>
    </Shell>
  );
}

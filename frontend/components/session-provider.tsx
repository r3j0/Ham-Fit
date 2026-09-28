"use client";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  getServerSession,
  getSession,
  refresh,
  startSession,
  subscribe,
} from "@/lib/session";
import { Loading, Notice, Shell } from "./ui";
import Link from "next/link";
export function useSession() {
  return useSyncExternalStore(subscribe, getSession, getServerSession);
}
export function SessionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void startSession();
  }, []);
  return children;
}
export function RequireSession({ children }: { children: React.ReactNode }) {
  const session = useSession(),
    router = useRouter(),
    path = usePathname();
  useEffect(() => {
    if (session.status === "anonymous")
      router.replace(
        `/login?next=${encodeURIComponent(path + window.location.search)}`,
      );
  }, [session.status, router, path]);
  if (session.status === "error")
    return (
      <Shell>
        <div className="content stack">
          <Notice>{session.error}</Notice>
          <button
            className="button primary"
            onClick={() => {
              void refresh().catch(() => {});
            }}
          >
            다시 연결하기
          </button>
          <Link className="text-link" href="/login">
            로그인 화면으로
          </Link>
        </div>
      </Shell>
    );
  if (session.status !== "authenticated")
    return (
      <Shell>
        <Loading label="로그인 상태를 확인하고 있어요" />
      </Shell>
    );
  return (
    <div key={`${session.user?.id}:${session.generation}`}>{children}</div>
  );
}

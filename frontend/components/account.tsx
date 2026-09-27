"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";
import { api, logout } from "@/lib/session";
import { errorMessage } from "@/lib/http";
import type { User } from "@/lib/types";
import { ArtworkSlot, Dialog, Loading, Notice, Shell } from "./ui";
import { BirthProfileForm } from "./birth-profile-form";
export function Account() {
  const [user, setUser] = useState<User | null>(null),
    [profileError, setProfileError] = useState(""),
    [logoutError, setLogoutError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const c = new AbortController();
    api<User>("/auth/me", { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) setUser(r.data);
      })
      .catch((e) => {
        if (!c.signal.aborted) setProfileError(errorMessage(e));
      });
    return () => c.abort();
  }, [retry]);
  async function signOut() {
    setBusy(true);
    setLogoutError("");
    try {
      await logout();
      router.replace("/login");
    } catch (e) {
      setLogoutError(errorMessage(e));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <h1 className="sr-only">내 프로필</h1>
      <div className="content stack">
        {logoutError && <Notice>{logoutError}</Notice>}
        {user ? (
          <>
            <div className="profile-card">
              <ArtworkSlot small />
              <div className="profile-copy">
                <h2>나의 건강한 일상</h2>
                <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
                  {user.email}
                </p>
              </div>
            </div>
          </>
        ) : profileError ? (
          <>
            <Notice>{profileError}</Notice>
            <button
              className="button secondary"
              onClick={() => {
                setProfileError("");
                setRetry((v) => v + 1);
              }}
            >
              다시 불러오기
            </button>
          </>
        ) : (
          <Loading />
        )}
        <div className="menu-card">
          {user && (
            <div className="menu-row">
              <span className="muted">가입일</span>
              <span>
                {new Intl.DateTimeFormat("ko-KR", {
                  timeZone: "Asia/Seoul",
                  dateStyle: "long",
                }).format(new Date(user.created_at))}
              </span>
            </div>
          )}
          <Link href="/measurements" className="menu-row">
            <strong>내 측정 기록</strong>
            <ChevronRight size={20} />
          </Link>
          <Link href="/workouts" className="menu-row">
            <strong>내 운동 이력</strong>
            <ChevronRight size={20} />
          </Link>
        </div>
        <BirthProfileForm />
        <button
          className="button secondary"
          onClick={() => setConfirm(true)}
          disabled={busy}
        >
          <LogOut size={18} />
          로그아웃
        </button>
        <p className="support-copy">오늘의 기록이 내일의 나를 알려줘요.</p>
      </div>
      {confirm && (
        <Dialog
          title="로그아웃할까요?"
          onClose={() => setConfirm(false)}
          busy={busy}
        >
          <div className="stack">
            <p className="muted">
              다음에 돌아오면 이메일로 다시 로그인할 수 있어요.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setConfirm(false)}
                disabled={busy}
              >
                취소
              </button>
              <button
                className="button primary"
                onClick={() => void signOut()}
                disabled={busy}
              >
                {busy ? "로그아웃 중" : "로그아웃"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Shell>
  );
}

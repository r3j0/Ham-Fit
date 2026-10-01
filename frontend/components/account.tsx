"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AccountCharacter } from "./account-character";
import { LatestFitness } from "./latest-fitness";
import { ProfileActivityReport } from "./profile-activity-report";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut } from "lucide-react";
import { logout } from "@/lib/session";
import { errorMessage } from "@/lib/http";
import { useUserProfile } from "./user-profile-provider";
import { Dialog, Loading, Notice, Shell } from "./ui";
export function Account() {
  const { data: user, error: profileError, reload } = useUserProfile();
  const [logoutError, setLogoutError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const router = useRouter();
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
    <Shell className="account-shell">
      <div className="content stack">
        <header className="profile-toolbar">
          <h1>내 프로필</h1>
          {user && (
            <div
              className="profile-balance"
              role="group"
              aria-label="보유 재화"
            >
              <Image
                src="/icons/sunflower-seed.svg"
                width={24}
                height={34}
                alt="해바라기씨"
              />
              <strong>{user.currency.balance.toLocaleString("ko-KR")}</strong>
            </div>
          )}
        </header>
        {logoutError && <Notice>{logoutError}</Notice>}
        {user ? (
          <div className="profile-card">
            <div className="profile-identity">
              <AccountCharacter />
              <div className="profile-copy">
                <div className="profile-heading">
                  <h2>{user.nickname ?? "닉네임"}</h2>
                </div>
                <p className="profile-email">{user.email}</p>
              </div>
            </div>
            {user.isOnboarded && (
              <div className="profile-insights stack">
                <LatestFitness />
              </div>
            )}
            <ProfileActivityReport createdAt={user.created_at} />
          </div>
        ) : profileError ? (
          <>
            <Notice>{profileError}</Notice>
            <button className="button secondary" onClick={reload}>
              다시 불러오기
            </button>
          </>
        ) : (
          <Loading />
        )}
        <div className="profile-actions stack">
          <div className="menu-card">
            <Link href="/measurements" className="menu-row">
              <strong>내 측정 기록</strong>
              <ChevronRight size={20} />
            </Link>
            <Link href="/account/workouts" className="menu-row">
              <strong>내 운동 이력</strong>
              <ChevronRight size={20} />
            </Link>
            <Link href="/account/preferences" className="menu-row">
              <strong>운동 설정</strong>
              <ChevronRight size={20} aria-hidden="true" />
            </Link>
            <Link href="/account/settings" className="menu-row">
              <strong>계정 설정</strong>
              <ChevronRight size={20} />
            </Link>
          </div>
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

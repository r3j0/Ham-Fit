"use client";
import Link from "next/link";
import { HomeGroups } from "./home-groups";
import { NotificationBell } from "./notification-bell";
import { SeedBalance } from "./seed-balance";
import { MyCharacter } from "./my-character";
import { RewardLinks } from "./personal-roulette";
import { ArrowRight, ClipboardList } from "lucide-react";
import { Loading, Notice, Shell } from "./ui";
import { TodayWorkout } from "./today-workout";
import { WorkoutStreak } from "./workout-streak";
import { useUserProfile } from "./user-profile-provider";

export function Home() {
  const profile = useUserProfile();
  const user = profile.data;
  return (
    <Shell className="home-shell">
      <h1 className="sr-only">메인</h1>
      <div className="content stack home-content">
        <header className="home-toolbar">
          <NotificationBell />
          {user && (
            <Link
              href="/shop"
              className="home-balance-link"
              aria-label={`상점, 보유 해바라기씨 ${user.currency.balance.toLocaleString("ko-KR")}개`}
            >
              <SeedBalance balance={user.currency.balance} />
            </Link>
          )}
        </header>
        {profile.status === "loading" && (
          <Loading label="나의 기록을 확인하고 있어요" />
        )}
        {profile.status === "error" && (
          <div className="stack">
            <Notice>{profile.error}</Notice>
            <button className="button secondary" onClick={profile.reload}>
              다시 불러오기
            </button>
          </div>
        )}
        {user && (
          <>
            {!user.isOnboarded && (
              <section className="feature-card home-intro stack">
                <h2>내 체력 기록부터 시작해요</h2>
                <p className="muted">
                  국민체력100 결과표가 있다면 측정한 항목부터 등록해 보세요.
                </p>
                <Link className="button primary" href="/onboarding">
                  체력 기록 등록하기
                  <ArrowRight size={18} />
                </Link>
              </section>
            )}
            <div className="home-companions">
              <div className="home-mascot-stage">
                <MyCharacter />
              </div>
              <HomeGroups />
            </div>
            <div
              className="home-activity"
              data-current-workout={
                user.currentCurriculum &&
                user.currentCurriculum.status !== "completed"
                  ? true
                  : undefined
              }
            >
              <section className="stack" aria-labelledby="today-title">
                <div className="section-heading">
                  <ClipboardList size={22} />
                  <h2 id="today-title">오늘의 운동</h2>
                </div>
                <TodayWorkout embedded />
              </section>
              <WorkoutStreak />
              <RewardLinks />
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

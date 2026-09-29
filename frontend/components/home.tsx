"use client";
import Link from "next/link";
import { GroupMascots } from "./mascot/mascot-scenes";
import { BreathingMascot } from "./mascot/BreathingMascot";
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
                <BreathingMascot size={256} label="편안하게 숨 쉬는 햄스터" />
              </div>
              <GroupMascots />
            </div>
            <Link className="text-link" href="/account/notifications">
              그룹 알림 확인하기
            </Link>
            <Link className="button secondary" href="/groups">
              내 그룹과 함께 운동하기
            </Link>
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
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

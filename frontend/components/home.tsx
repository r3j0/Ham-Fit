"use client";
import Link from "next/link";
import { BreathingMascot } from "./mascot/BreathingMascot";
import { ArrowRight, ClipboardList } from "lucide-react";
import { Loading, Notice, Shell } from "./ui";
import { WorkoutStreak } from "./workout-streak";
import { useUserProfile } from "./user-profile-provider";

export function Home() {
  const profile = useUserProfile();
  const user = profile.data;
  const assignment = user?.currentCurriculum;
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
            <WorkoutStreak />
            <div className="home-mascot-stage">
              <BreathingMascot size={320} label="편안하게 숨 쉬는 햄스터" />
            </div>
            <section className="stack" aria-labelledby="today-title">
              <div className="section-heading">
                <ClipboardList size={22} />
                <h2 id="today-title">오늘의 운동</h2>
              </div>
              {assignment ? (
                <div className="curriculum-card stack">
                  <span className="status-badge">
                    {assignment.status === "completed" ? "완료" : "배정됨"}
                  </span>
                  <h3>{assignment.curriculum.name}</h3>
                  {assignment.status === "completed" ? (
                    <p className="muted">
                      배정된 운동을 완료했어요. 다음 운동은 아직 배정되지
                      않았어요.
                    </p>
                  ) : (
                    <>
                      <p className="muted" id="curriculum-pending">
                        배정된 운동의 상세 안내를 준비하고 있어요.
                      </p>
                      <button
                        className="button secondary"
                        disabled
                        aria-describedby="curriculum-pending"
                      >
                        운동 시작 준비 중
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="curriculum-card stack">
                  <h3>아직 배정된 운동이 없어요</h3>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}

"use client";
import Link from "next/link";
import { ChevronRight, Flame } from "lucide-react";
import { completedRoutineDate } from "@/lib/workout-history";
import { WorkoutWeek } from "./workout-week";
import {
  useWorkoutHistory,
  WorkoutHistoryFeedback,
} from "./workout-history-provider";
import { getActivityProfile } from "@/lib/activity-profile";
import { useApiResource } from "./use-api-resource";
import { Loading, Notice } from "./ui";
import { errorMessage } from "@/lib/http";
import styles from "./workout-history.module.css";

export function WorkoutStreak() {
  const { today, completed, routines, ready, error, legacyUnavailable } =
    useWorkoutHistory();
  const completedRoutines = new Set(
    routines
      .map(completedRoutineDate)
      .filter((day): day is string => day !== null),
  );
  const activity = useApiResource(getActivityProfile);
  return (
    <section className="stack" aria-labelledby="workout-streak-title">
      <div className={`section-heading ${styles.streakHeading}`}>
        <Flame size={22} aria-hidden="true" />
        <h2 id="workout-streak-title">연속 운동</h2>
      </div>
      <div className={styles.streak}>
        <div className={styles.streakColumns}>
          <div className={styles.summary}>
            {activity.error !== undefined ? (
              <div className="stack-sm">
                <Notice>{errorMessage(activity.error)}</Notice>
                <button className="text-button" onClick={activity.reload}>
                  활동 정보 다시 불러오기
                </button>
              </div>
            ) : activity.data ? (
              <p className={styles.streakCount}>
                <strong>{activity.data.streak}일</strong>
                <span> 연속 운동 중</span>
              </p>
            ) : (
              <Loading />
            )}
          </div>
          {!ready || error ? (
            <WorkoutHistoryFeedback />
          ) : (
            <WorkoutWeek
              today={today}
              completed={completed}
              completedRoutines={completedRoutines}
            />
          )}
        </div>
        {legacyUnavailable && (
          <Notice tone="info">
            이전 단일 운동 기록을 불러오지 못해 최근 기록에 일부 누락이 있을 수
            있어요.
          </Notice>
        )}
        <div className={styles.streakFooter}>
          {ready && !error && !legacyUnavailable && (
            <p className={styles.hint}>
              {completed.has(today)
                ? "오늘 완료한 운동 기록이 있어요."
                : "오늘의 운동으로 꾸준함을 이어가요."}
            </p>
          )}
          <Link
            className={styles.historyLink}
            href="/workout#workout-history-title"
          >
            운동 기록 보기
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

"use client";
import Link from "next/link";
import { Check, ChevronRight, Flame } from "lucide-react";
import { dateFromKey, shiftDay } from "@/lib/workout-history";
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
  const { today, completed, ready, error, legacyUnavailable } =
    useWorkoutHistory();
  const activity = useApiResource(getActivityProfile);
  const days = Array.from({ length: 7 }, (_, index) =>
    shiftDay(today, index - 6),
  );
  return (
    <section className="stack" aria-labelledby="workout-streak-title">
      <div className="section-heading">
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
            <ol className={styles.week} aria-label="최근 7일 운동 기록">
              {days.map((day) => {
                const date = dateFromKey(day);
                const done = completed.has(day);
                return (
                  <li
                    key={day}
                    aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일${day === today ? " 오늘" : ""}, ${done ? "운동함" : "완료 기록 없음"}`}
                  >
                    <span className={styles.weekday} aria-hidden="true">
                      {day === today ? "오늘" : "일월화수목금토"[date.getDay()]}
                    </span>
                    <span
                      className={styles.weekMark}
                      data-completed={done || undefined}
                      data-today={day === today || undefined}
                      aria-hidden="true"
                    >
                      {done ? (
                        <Check size={19} strokeWidth={2.5} />
                      ) : (
                        <span className={styles.emptyDot} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {legacyUnavailable && (
          <Notice tone="info">
            이전 단일 운동 기록을 불러오지 못해 최근 기록에 일부 누락이 있을 수
            있어요.
          </Notice>
        )}
        <p className="caption">
          연속 운동에는 기존 운동 이력이 반영되며, 새 루틴 완료는 아직 포함되지
          않아요.
        </p>
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

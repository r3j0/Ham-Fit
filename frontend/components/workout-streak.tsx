"use client";
import Link from "next/link";
import { Check, ChevronRight, Flame } from "lucide-react";
import { dateFromKey, shiftDay, workoutStreak } from "@/lib/workout-history";
import {
  useWorkoutHistory,
  WorkoutHistoryFeedback,
} from "./workout-history-provider";
import styles from "./workout-history.module.css";

export function WorkoutStreak() {
  const {
    today,
    legacyCompleted: completed,
    ready,
    error,
    legacyUnavailable,
  } = useWorkoutHistory();
  const streak = workoutStreak(completed, today);
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
        {!ready || error || legacyUnavailable ? (
          <WorkoutHistoryFeedback />
        ) : (
          <div className={styles.streakColumns}>
            <div className={styles.summary}>
              <p className={styles.streakCount}>
                <strong>{streak}일</strong>
                <span> 연속 운동 중</span>
              </p>
            </div>
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
          </div>
        )}
        <div className={styles.streakFooter}>
          {ready && !error && !legacyUnavailable && (
            <p className={styles.hint}>
              {completed.has(today)
                ? "오늘의 운동을 완료했어요!"
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

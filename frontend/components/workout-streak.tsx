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
  const { today, completed, ready, error } = useWorkoutHistory();
  const streak = workoutStreak(completed, today);
  const days = Array.from({ length: 7 }, (_, index) =>
    shiftDay(today, index - 6),
  );
  return (
    <section className={styles.streak} aria-labelledby="workout-streak-title">
      <div className={styles.heading}>
        <h2 id="workout-streak-title">
          <Flame size={20} aria-hidden="true" />
          운동 스트릭
        </h2>
      </div>
      {!ready || error ? (
        <WorkoutHistoryFeedback />
      ) : (
        <>
          <p className={styles.streakCount}>
            <strong>{streak}일</strong> 연속 운동 중
          </p>
          <p className={styles.hint}>
            {completed.has(today)
              ? "오늘의 운동을 완료했어요!"
              : "오늘의 운동으로 꾸준함을 이어가요."}
          </p>
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
        </>
      )}
      <Link
        className={styles.historyLink}
        href="/workout#workout-history-title"
      >
        운동 기록 보기
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </section>
  );
}

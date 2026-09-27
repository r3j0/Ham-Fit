"use client";
import Link from "next/link";
import { Check, ChevronRight, Flame } from "lucide-react";
import {
  dateFromKey,
  shiftDay,
  workoutStreak,
} from "@/lib/workout-history-preview";
import { useWorkoutHistoryPreview } from "./workout-history-preview-provider";
import styles from "./workout-history.module.css";

export function WorkoutStreak() {
  const { today, completed } = useWorkoutHistoryPreview();
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
        <span className={styles.previewBadge}>예시 기록</span>
      </div>
      <p className={styles.streakCount}>
        <strong>{streak}일</strong> 연속 운동 중
      </p>
      <p className={styles.hint}>
        {completed.has(today)
          ? "오늘도 운동 체크 완료!"
          : "오늘의 체크로 꾸준함을 이어가요."}
      </p>
      <ol className={styles.week} aria-label="최근 7일 운동 기록">
        {days.map((day) => {
          const date = dateFromKey(day);
          const done = completed.has(day);
          return (
            <li
              key={day}
              aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일${day === today ? " 오늘" : ""}, ${done ? "운동함" : "운동 안 함"}`}
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
      <Link className={styles.historyLink} href="/workout">
        운동 기록 보기
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </section>
  );
}

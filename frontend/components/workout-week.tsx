"use client";
import Image from "next/image";
import { dateFromKey, shiftDay } from "@/lib/workout-history";
import { SeedIcon } from "./seed-icon";
import { CompletionMotion } from "./completion-motion";
import styles from "./workout-history.module.css";

export function WorkoutWeek({
  today,
  completed,
  completedRoutines,
  onTodayAnimationEnd,
}: {
  today: string;
  completed: ReadonlySet<string>;
  completedRoutines: ReadonlySet<string>;
  onTodayAnimationEnd?: () => void;
}) {
  const days = Array.from({ length: 7 }, (_, index) =>
    shiftDay(today, index - 6),
  );
  return (
    <ol className={styles.week} aria-label="최근 7일 운동 기록">
      {days.map((day) => {
        const date = dateFromKey(day);
        const done = completed.has(day);
        const fullRoutine = completedRoutines.has(day);
        return (
          <li
            key={day}
            aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일${day === today ? " 오늘" : ""}, ${fullRoutine ? "운동 루틴 완료" : done ? "운동 영상 완료" : "완료 기록 없음"}`}
          >
            <span className={styles.weekday} aria-hidden="true">
              {day === today ? "오늘" : "일월화수목금토"[date.getDay()]}
            </span>
            <span
              className={styles.weekMark}
              data-completed={done || undefined}
              data-today={day === today || undefined}
              data-workout-status={
                fullRoutine
                  ? "routine_completed"
                  : done
                    ? "video_completed"
                    : "none"
              }
              aria-hidden="true"
            >
              {fullRoutine ? (
                day === today && onTodayAnimationEnd ? (
                  <CompletionMotion
                    kind="sunflower"
                    onComplete={onTodayAnimationEnd}
                    className={styles.completionIcon}
                  >
                    <Image
                      src="/icons/sunflower.png"
                      width={34}
                      height={34}
                      alt=""
                    />
                  </CompletionMotion>
                ) : (
                  <Image
                    src="/icons/sunflower.png"
                    width={34}
                    height={34}
                    alt=""
                    className={styles.completionIcon}
                  />
                )
              ) : done ? (
                <SeedIcon height={34} className={styles.completionIcon} />
              ) : (
                <span className={styles.emptyDot} />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

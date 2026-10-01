"use client";
import Link from "next/link";
import { useWorkoutHistoryLinks } from "./use-workout-history-links";
import { PlayCircle } from "lucide-react";
import { completedDate } from "@/lib/workout-history";
import { workoutHref } from "@/lib/workout-routine";
import { displayDate } from "@/lib/measurements";
import { WorkoutCalendar } from "./workout-calendar";
import { useActivityHistory } from "./use-activity-history";
import { Header, Loading, Notice, Shell } from "./ui";
import styles from "./workout-history.module.css";

export function WorkoutHistoryDay({ date }: { date: string }) {
  const { basePath, overviewHref } = useWorkoutHistoryLinks();

  const { workouts, ready, error, loading, reload } = useActivityHistory(
    date,
    date,
  );
  const records = workouts
    .filter((workout) => completedDate(workout) === date)
    .sort(
      (a, b) =>
        a.completedAt!.localeCompare(b.completedAt!) ||
        a.id.localeCompare(b.id),
    );
  return (
    <Shell>
      <Header title="운동 기록 상세" back={overviewHref} />
      <div className={`content stack ${styles.detail}`}>
        <WorkoutCalendar key={date} selectedDate={date} />
        {error ? (
          <>
            <Notice>선택한 날짜의 기록을 불러오지 못했어요.</Notice>
            <button className="text-button" disabled={loading} onClick={reload}>
              선택한 날짜 다시 불러오기
            </button>
          </>
        ) : !ready ? (
          <Loading label="선택한 날짜의 기록을 불러오고 있어요" />
        ) : (
          <section
            className={styles.records}
            aria-labelledby="daily-workouts-title"
          >
            <h2 id="daily-workouts-title">
              <time dateTime={date}>{displayDate(date)}</time> 운동 기록
            </h2>
            {records.length ? (
              <ul
                className={styles.recordList}
                aria-label="선택한 날짜의 운동 기록"
              >
                {records.map((workout) => (
                  <li key={workout.id}>
                    <Link
                      className={styles.recordLink}
                      href={workoutHref(
                        workout,
                        true,
                        basePath.startsWith("/account"),
                      )}
                      aria-label={`${workout.video.title} 운동 다시보기`}
                    >
                      <div>
                        <h3>{workout.video.title}</h3>
                        <p className="caption">
                          {new Intl.DateTimeFormat("ko-KR", {
                            timeZone: "Asia/Seoul",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(workout.completedAt!))}{" "}
                          완료 ·{" "}
                          {Math.floor(workout.video.durationSeconds / 60)}분{" "}
                          {workout.video.durationSeconds % 60}초
                        </p>
                      </div>
                      <PlayCircle size={24} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.recordEmpty}>
                이 날짜에 완료한 운동 기록이 없어요.
              </p>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}

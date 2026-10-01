"use client";
import Link from "next/link";
import { assessmentHref } from "@/lib/workout-mode";
import { TodayWorkout } from "./today-workout";
import { WorkoutCalendar } from "./workout-calendar";
import { WorkoutHistoryMascot } from "./workout-history-mascot";
import { Header, Notice, Shell } from "./ui";
import styles from "./workout-overview.module.css";

export function WorkoutOverview({
  unsupported = false,
}: {
  unsupported?: boolean;
}) {
  return (
    <Shell>
      <Header title="운동" showBrand={false} />
      {unsupported ? (
        <div className="content stack">
          <Notice>지원하지 않는 운동 과정이에요.</Notice>
          <Link className="button secondary" href={assessmentHref}>
            성인 간이측정 열기
          </Link>
          <Link className="text-link" href="/workout">
            오늘의 운동으로
          </Link>
        </div>
      ) : (
        <div className={`content ${styles.overview}`}>
          <section
            className={styles.assignment}
            aria-labelledby="today-workout-title"
          >
            <TodayWorkout embedded showAll />
          </section>
          <div className={styles.history}>
            <WorkoutHistoryMascot />
            <WorkoutCalendar />
          </div>
        </div>
      )}
    </Shell>
  );
}

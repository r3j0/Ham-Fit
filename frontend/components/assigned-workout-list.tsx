import Link from "next/link";
import { Check } from "lucide-react";
import type { Workout } from "@/lib/workout-types";
import styles from "./assigned-workout-list.module.css";

export function AssignedWorkoutList({
  workouts,
}: {
  workouts: readonly Workout[];
}) {
  return (
    <ul className={styles.list} aria-label="오늘 배정된 운동">
      {workouts.map((workout) => (
        <li key={workout.id} className={styles.item}>
          <div className={styles.description}>
            <h3>{workout.video.title}</h3>
            <p className="caption">
              {Math.floor(workout.video.durationSeconds / 60)}분{" "}
              {workout.video.durationSeconds % 60}초
              {workout.video.equipment.length > 0 &&
                ` · ${workout.video.equipment.join(", ")}`}
            </p>
          </div>
          {workout.status === "completed" ? (
            <span className={styles.completed}>
              <Check size={18} aria-hidden="true" />
              완료
            </span>
          ) : (
            <Link
              className={`button secondary ${styles.start}`}
              href={`/workouts/${workout.id}`}
            >
              {workout.status === "assigned"
                ? "운동 시작하기"
                : "운동 이어하기"}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

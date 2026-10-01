import Link from "next/link";
import { Check } from "lucide-react";
import type { Workout } from "@/lib/workout-types";
import { workoutHref } from "@/lib/workout-routine";
import styles from "./assigned-workout-list.module.css";
import { RoutinePrescription } from "./routine-prescription";

export function AssignedWorkoutList({
  workouts,
  started = false,
  activeId,
}: {
  workouts: readonly Workout[];
  started?: boolean;
  activeId?: string;
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
            {workout.routine && (
              <RoutinePrescription
                prescription={workout.routine.prescription}
              />
            )}
          </div>
          {workout.status === "completed" ? (
            <span className={styles.completed}>
              <Check size={18} aria-hidden="true" />
              완료
            </span>
          ) : activeId && workout.id !== activeId ? (
            <button className={`button secondary ${styles.start}`} disabled>
              앞 운동 완료 후 시작
            </button>
          ) : (
            <Link
              className={`button secondary ${styles.start}`}
              href={workoutHref(workout)}
            >
              {!started && workout.status === "assigned"
                ? "운동 시작하기"
                : "운동 이어하기"}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

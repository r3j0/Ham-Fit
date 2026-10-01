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
          </div>
          <div className={styles.prescription}>
            {workout.routine && (
              <RoutinePrescription
                prescription={workout.routine.prescription}
                compact
              />
            )}
          </div>
          {workout.status === "completed" ? (
            <span className={styles.completed}>
              <Check size={18} aria-hidden="true" />
              완료
            </span>
          ) : activeId &&
            workout.id !== activeId &&
            !(
              workout.routine &&
              ["interrupted", "not_performed"].includes(workout.status)
            ) ? null : (
            <Link
              className={`button secondary ${styles.start}`}
              href={workoutHref(workout)}
            >
              {workout.routine &&
              (workout.status === "interrupted" ||
                workout.status === "not_performed") ? (
                <>
                  <span className={styles.incomplete}>미완료</span>
                  <span>다시 운동하기</span>
                </>
              ) : !started && workout.status === "assigned" ? (
                "운동 시작하기"
              ) : (
                "운동 이어하기"
              )}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

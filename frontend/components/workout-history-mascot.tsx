"use client";
import { assignedWorkoutsForDay } from "@/lib/assigned-workouts";
import { MemberMascot } from "./member-mascot";
import { useWorkoutHistory } from "./workout-history-provider";
import styles from "./workout-overview.module.css";

export function WorkoutHistoryMascot() {
  const history = useWorkoutHistory();
  if (!history.ready || history.error) return null;
  const rows = assignedWorkoutsForDay(history.workouts, history.today);
  const pose = !rows.length
    ? "lying"
    : rows.every((row) => row.status === "completed")
      ? "drink"
      : rows.some((row) =>
            ["interrupted", "not_performed"].includes(row.status),
          )
        ? "droopy"
        : "run";
  return (
    <div className={styles.mascotStage}>
      <MemberMascot
        pose={pose}
        size={196}
        label="오늘의 운동 상태를 보여주는 내 햄스터"
      />
    </div>
  );
}

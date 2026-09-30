import { Check, Clock3, Minus } from "lucide-react";
import type { Workout, WorkoutStatus } from "@/lib/workout-types";
import { displayDate } from "@/lib/measurements";
import styles from "./workout-summary.module.css";
import { RoutinePrescription } from "./routine-prescription";

export const workoutLabels: Record<WorkoutStatus, string> = {
  assigned: "시작 전",
  in_progress: "진행 중",
  not_performed: "미진행",
  interrupted: "중단",
  completed: "완료",
};

function playbackTime(seconds: number) {
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export function WorkoutSummary({ workout }: { workout: Workout }) {
  const { video, progress, status } = workout;
  const completed = status === "completed";
  const inProgress = status === "in_progress";
  const StatusIcon = completed ? Check : inProgress ? Clock3 : Minus;
  const statusLabel = completed
    ? "운동 완료"
    : inProgress
      ? "운동 진행 중"
      : `운동 미완료 (${workoutLabels[status]})`;
  const percent = Math.floor(progress.ratio * 100);
  return (
    <div className="stack-sm">
      <time className="caption" dateTime={workout.koreanDate}>
        {displayDate(workout.koreanDate)}
      </time>
      <div className={styles.title}>
        <span
          className={`${styles.status} ${completed ? styles.completed : inProgress ? styles.inProgress : styles.incomplete}`}
          role="img"
          aria-label={statusLabel}
        >
          <StatusIcon size={18} strokeWidth={2.5} aria-hidden="true" />
        </span>
        <h2>{video.title}</h2>
      </div>
      <p className="muted">
        {Math.floor(video.durationSeconds / 60)}분 {video.durationSeconds % 60}
        초 ·{" "}
        {video.equipment.length ? video.equipment.join(", ") : "장비 정보 없음"}
      </p>
      {workout.routine && (
        <>
          <p className="muted">
            {workout.routine.order}/{workout.routine.totalItems}번째 운동
          </p>
          <RoutinePrescription
            prescription={workout.routine.prescription}
            className="muted"
          />
        </>
      )}
      <div className={styles.progressPanel}>
        <span className={styles.progressLabel}>시청 기록</span>
        <progress
          className={styles.progress}
          max={1}
          value={progress.ratio}
          aria-label="저장된 시청 진행률"
          aria-valuetext={`${percent}%, ${Math.floor(progress.watchedSeconds)}초 / ${progress.durationSeconds}초`}
        />
        <strong className={styles.progressPercent}>{percent}%</strong>
        <p className={styles.progressTime}>
          {playbackTime(progress.watchedSeconds)} /{" "}
          {playbackTime(progress.durationSeconds)}
        </p>
      </div>
    </div>
  );
}

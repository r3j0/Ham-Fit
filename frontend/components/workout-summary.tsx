import type { Workout, WorkoutStatus } from "@/lib/workout-types";
import { displayDate } from "@/lib/measurements";

export const workoutLabels: Record<WorkoutStatus, string> = {
  assigned: "시작 전",
  in_progress: "진행 중",
  not_performed: "미진행",
  interrupted: "중단",
  completed: "완료",
};
export function WorkoutSummary({ workout }: { workout: Workout }) {
  const { video, progress } = workout;
  return (
    <div className="stack-sm">
      <p className="caption">
        {displayDate(workout.koreanDate)} 배정 · {workoutLabels[workout.status]}
      </p>
      <h2>{video.title}</h2>
      <p className="muted">
        {Math.floor(video.durationSeconds / 60)}분 {video.durationSeconds % 60}
        초 ·{" "}
        {video.equipment.length ? video.equipment.join(", ") : "장비 정보 없음"}
      </p>
      <progress
        className="workout-progress"
        max={1}
        value={progress.ratio}
        aria-label="저장된 시청 진행률"
      />
      <p className="caption">
        저장된 시청량 {Math.floor(progress.watchedSeconds)}초 /{" "}
        {progress.durationSeconds}초 ({Math.floor(progress.ratio * 100)}%)
      </p>
    </div>
  );
}

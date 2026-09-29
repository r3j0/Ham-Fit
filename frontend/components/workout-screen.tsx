"use client";
import Link from "next/link";
import { useWorkoutHistoryLinks } from "./use-workout-history-links";
import { completedDate } from "@/lib/workout-history";
import { useEffect, useState } from "react";
import { getWorkout } from "@/lib/workouts";
import type { Workout } from "@/lib/workout-types";
import { workoutHref } from "@/lib/workout-routine";
import { Header, Loading, Notice, Shell } from "./ui";
import { WorkoutError } from "./workout-error";
import { WorkoutPlayer } from "./workout-player";
export function WorkoutScreen({
  id,
  replay = false,
}: {
  id: string;
  replay?: boolean;
}) {
  const { basePath, overviewHref } = useWorkoutHistoryLinks();
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [error, setError] = useState<unknown>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getWorkout(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setWorkout(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [id, retry]);
  const day = workout && completedDate(workout);
  const historyHref = day ? `${basePath}/history/${day}` : overviewHref;
  return (
    <Shell>
      <Header
        title={replay ? "운동 다시보기" : "운동 중"}
        back={replay ? historyHref : "/workout"}
      />
      <div className="content stack">
        {error !== undefined && (
          <>
            <WorkoutError error={error} />
            <button
              className="button secondary"
              onClick={() => {
                setError(undefined);
                setRetry((n) => n + 1);
              }}
            >
              운동 다시 불러오기
            </button>
          </>
        )}
        {workout && workout.koreanDate > workout.serverKoreanDate ? (
          <>
            <Notice tone="info">
              {workout.koreanDate}에 시작할 운동이에요.
            </Notice>
            <h2>{workout.video.title}</h2>
            {workout.routine && (
              <p>
                {workout.routine.prescription.text} ·{" "}
                {workout.routine.prescription.sets}세트 · 휴식{" "}
                {workout.routine.prescription.restSec}초
              </p>
            )}
            <Link className="button secondary" href="/workout">
              오늘의 운동으로
            </Link>
          </>
        ) : workout ? (
          replay && workout.status !== "completed" ? (
            <>
              <Notice tone="info">완료한 운동만 다시 볼 수 있어요.</Notice>
              <Link className="button primary" href={workoutHref(workout)}>
                운동 이어하기
              </Link>
            </>
          ) : (
            <WorkoutPlayer key={workout.id} initial={workout} replay={replay} />
          )
        ) : (
          error === undefined && <Loading />
        )}
      </div>
    </Shell>
  );
}

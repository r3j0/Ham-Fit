"use client";
import Link from "next/link";
import { completedDate } from "@/lib/workout-history";
import { useEffect, useState } from "react";
import { getWorkout } from "@/lib/workouts";
import type { Workout } from "@/lib/workout-types";
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
  const historyHref = day ? `/workouts/history/${day}` : "/workout";
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
        {workout ? (
          replay && workout.status !== "completed" ? (
            <>
              <Notice tone="info">완료한 운동만 다시 볼 수 있어요.</Notice>
              <Link className="button primary" href={`/workouts/${id}`}>
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

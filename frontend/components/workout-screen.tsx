"use client";
import { useEffect, useState } from "react";
import { getWorkout } from "@/lib/workouts";
import type { Workout } from "@/lib/workout-types";
import { Header, Loading, Shell } from "./ui";
import { WorkoutError } from "./workout-error";
import { WorkoutSummary } from "./workout-summary";
export function WorkoutScreen({ id }: { id: string }) {
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
  return (
    <Shell>
      <Header title="나의 운동" back="/" />
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
          <WorkoutSummary workout={workout} />
        ) : (
          error === undefined && <Loading />
        )}
      </div>
    </Shell>
  );
}

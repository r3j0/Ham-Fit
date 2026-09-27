"use client";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/http";
import { getCurrentWorkout, requestTodayWorkout } from "@/lib/workouts";
import type { Workout } from "@/lib/workout-types";
import { workoutJournal, type WorkoutWriter } from "@/lib/workout-journal";
import { useSession } from "./session-provider";
import { Header, Loading, Notice, Shell } from "./ui";
import { WorkoutError } from "./workout-error";
import { AssignedWorkoutList } from "./assigned-workout-list";
import {
  useWorkoutHistory,
  WorkoutHistoryFeedback,
} from "./workout-history-provider";
import { assignedWorkoutsForDay } from "@/lib/assigned-workouts";

export function TodayWorkout({ embedded = false }: { embedded?: boolean }) {
  const history = useWorkoutHistory();
  const session = useSession();
  const userId = session.user!.id;
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const writer = useRef<WorkoutWriter | null>(null);
  const guard = useRef(false);
  const readVersion = useRef(0);
  useEffect(() => {
    const lease = workoutJournal.acquire(userId, "today");
    writer.current = lease;
    return () => {
      lease.release();
      writer.current = null;
    };
  }, [userId]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (guard.current) return;
      const version = ++readVersion.current;
      try {
        const value = await getCurrentWorkout(controller.signal);
        if (controller.signal.aborted || version !== readVersion.current)
          return;
        setWorkout(value);
        setPending((writer.current?.read().length ?? 0) > 0);
        setLoaded(true);
        // A background read must not hide a failed creation or its recovery link.
      } catch (e) {
        if (!controller.signal.aborted && version === readVersion.current) {
          setError(e);
          setPending((writer.current?.read().length ?? 0) > 0);
          setLoaded(true);
        }
      }
    }
    void load();
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    const interval = setInterval(focus, 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [retry]);
  async function create() {
    const lease = writer.current;
    if (guard.current || !lease?.active()) return;
    guard.current = true;
    ++readVersion.current;
    const request = lease.read()[0] ?? { key: crypto.randomUUID(), body: "{}" };
    lease.save([request]);
    setPending(true);
    setBusy(true);
    setError(undefined);
    try {
      const value = await requestTodayWorkout(request.key);
      if (!lease.active()) return;
      lease.save([]);
      setPending(false);
      setWorkout(value);
      history.reload();
    } catch (e) {
      if (!lease.active()) return;
      // Definite validation/readiness failures created no assignment. Unknown outcomes keep the key.
      if (
        e instanceof ApiError &&
        (e.status === 400 ||
          [
            "DATE_OF_BIRTH_REQUIRED",
            "MEASUREMENT_REQUIRED",
            "AGE_UNSUPPORTED",
          ].includes(e.code ?? ""))
      ) {
        lease.save([]);
        setPending(false);
      }
      setError(e);
    } finally {
      if (lease.active()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  const workouts = assignedWorkoutsForDay(
    [...history.workouts, ...(workout ? [workout] : [])],
    workout?.serverKoreanDate ?? history.today,
  );
  const content = (
    <div className={embedded ? "stack" : "content stack"}>
      {!loaded ? (
        <Loading />
      ) : (
        <>
          {error !== undefined && <WorkoutError error={error} />}
          {!history.ready || history.error ? (
            <WorkoutHistoryFeedback />
          ) : (
            <>
              {workouts.length > 0 ? (
                <AssignedWorkoutList workouts={workouts} />
              ) : (
                <h2>아직 오늘 배정된 운동이 없어요</h2>
              )}
              {pending && (
                <Notice tone="info">
                  이전 추천 요청의 결과를 확인해야 해요. 같은 요청으로 다시
                  확인할 수 있어요.
                </Notice>
              )}
              {(!workouts.length || pending) && (
                <button
                  className="button primary"
                  onClick={() => void create()}
                  disabled={busy}
                >
                  {busy
                    ? "추천을 확인하고 있어요"
                    : pending
                      ? "이전 추천 요청 확인하기"
                      : "오늘 운동 추천받기"}
                </button>
              )}
            </>
          )}
          {error !== undefined && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setError(undefined);
                setRetry((n) => n + 1);
                history.reload();
              }}
            >
              운동 목록 다시 불러오기
            </button>
          )}
        </>
      )}
    </div>
  );
  return embedded ? (
    content
  ) : (
    <Shell>
      <Header title="오늘의 운동" />
      {content}
    </Shell>
  );
}

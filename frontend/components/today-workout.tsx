"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/http";
import { getCurrentRoutine, requestTodayRoutine } from "@/lib/workout-routines";
import { routineWorkouts, type WorkoutRoutine } from "@/lib/workout-routine";
import { nextRoutineHref } from "@/lib/workout-practice";
import {
  assignedWorkoutsForDay,
  currentWorkoutStep,
} from "@/lib/assigned-workouts";
import { workoutJournal, type WorkoutWriter } from "@/lib/workout-journal";
import { useSession } from "./session-provider";
import { Header, Loading, Notice, Shell } from "./ui";
import { WorkoutError } from "./workout-error";
import { AssignedWorkoutList } from "./assigned-workout-list";
import { useWorkoutHistory } from "./workout-history-provider";

export function TodayWorkout({
  embedded = false,
  showAll = false,
}: {
  embedded?: boolean;
  showAll?: boolean;
}) {
  const history = useWorkoutHistory();
  const userId = useSession().user!.id;
  const [current, setCurrent] = useState<WorkoutRoutine | null>(null);
  const [created, setCreated] = useState<WorkoutRoutine | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const writer = useRef<WorkoutWriter | null>(null);
  const guard = useRef(false);
  const version = useRef(0);
  useEffect(() => {
    // A previous v1 generation intent must be resolved with its original key.
    const legacy = workoutJournal.acquire(userId, "routine:next");
    let lease = legacy;
    if (!legacy.read().length) {
      legacy.release();
      lease = workoutJournal.acquire(userId, "routine:today");
    }
    writer.current = lease;
    queueMicrotask(() => {
      if (lease.active()) setPending(lease.read().length > 0);
    });
    return () => {
      lease.release();
      writer.current = null;
    };
  }, [userId]);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(
      () => setRemaining((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [remaining]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (guard.current) return;
      const read = ++version.current;
      try {
        const value = await getCurrentRoutine(controller.signal);
        if (controller.signal.aborted || read !== version.current) return;
        setCurrent(value);
        setError(undefined);
        setPending((writer.current?.read().length ?? 0) > 0);
        setLoaded(true);
      } catch (e) {
        if (!controller.signal.aborted && read === version.current) {
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
    if (guard.current || !lease?.active() || remaining) return;
    guard.current = true;
    ++version.current;
    const request = lease.read()[0] ?? { key: crypto.randomUUID(), body: "{}" };
    lease.save([request]);
    setPending(true);
    setBusy(true);
    setError(undefined);
    try {
      const value = await requestTodayRoutine(request.key);
      if (!lease.active()) return;
      lease.save([]);
      setPending(false);
      setCreated(value);
      // Replayed requests retain their original assignment date.
      if (value.koreanDate === value.serverKoreanDate) setCurrent(value);
      history.reload();
      setRetry((n) => n + 1);
    } catch (e) {
      if (!lease.active()) return;
      if (
        e instanceof ApiError &&
        (e.status === 400 ||
          [
            "DATE_OF_BIRTH_REQUIRED",
            "MEASUREMENT_REQUIRED",
            "AGE_UNSUPPORTED",
            "EXERCISE_GOAL_REQUIRED",
          ].includes(e.code ?? ""))
      ) {
        lease.save([]);
        setPending(false);
      }
      if (e instanceof ApiError && e.status === 429)
        setRemaining(e.retryAfter ?? 60);
      setError(e);
    } finally {
      if (lease.active()) {
        guard.current = false;
        setBusy(false);
      }
    }
  }
  const today = [
    history.today,
    current?.serverKoreanDate,
    created?.serverKoreanDate,
  ]
    .filter((day): day is string => !!day)
    .sort()
    .at(-1)!;
  const todayRoutine =
    current?.koreanDate === today
      ? current
      : history.routines.find((row) => row.koreanDate === today);
  const todayItems = assignedWorkoutsForDay(
    [
      ...history.workouts.filter((row) => !row.routine),
      ...(todayRoutine ? routineWorkouts(todayRoutine) : []),
    ],
    today,
  );
  const step = currentWorkoutStep(todayItems);
  const summary = todayRoutine
    ? `영상 운동 예상 ${todayRoutine.estimatedMinutes}분 · ${todayRoutine.progress.completedItems}/${todayRoutine.progress.totalItems}개 완료`
    : null;
  const content = (
    <div className={embedded ? "stack" : "content stack"}>
      {showAll && (
        <div className="between">
          <h2 id="today-workout-title">오늘의 운동</h2>
          {summary && <span className="caption">{summary}</span>}
        </div>
      )}
      {!loaded && !history.ready ? (
        <>
          <Loading />
          <button className="button primary workout-request" disabled>
            오늘 운동 준비하기
          </button>
        </>
      ) : (
        <>
          {error !== undefined && <WorkoutError error={error} />}
          {todayItems.length ? (
            <>
              {!showAll && summary && <p className="caption">{summary}</p>}
              {(showAll || step.workout) && (
                <AssignedWorkoutList
                  workouts={showAll ? todayItems : [step.workout!]}
                  started={step.started}
                  activeId={showAll ? step.workout?.id : undefined}
                />
              )}
              {!step.workout && (
                <>
                  <Notice tone="success">오늘의 모든 운동을 완료했어요.</Notice>
                  {todayRoutine && (
                    <Link
                      className="button primary"
                      href={nextRoutineHref(todayRoutine)}
                    >
                      오늘 운동 완료 확인
                    </Link>
                  )}
                </>
              )}
              {showAll && todayRoutine?.cardioRecommendation && (
                <section
                  className="feature-card stack-sm"
                  aria-label="유산소 운동 안내"
                >
                  <h3>마무리 유산소</h3>
                  <p>
                    {todayRoutine.cardioRecommendation.activity}{" "}
                    {todayRoutine.cardioRecommendation.minutes}분
                  </p>
                </section>
              )}
            </>
          ) : (
            error === undefined && (
              <p className="muted">
                아직 오늘 배정된 운동이 없어요. 오늘 할 운동을 준비해 보세요.
              </p>
            )
          )}
          {created && created.koreanDate !== today && (
            <Notice tone="info">
              이전 요청으로 준비한 {created.koreanDate} 운동을 확인했어요.{" "}
              <Link href="/workout#workout-history-title" className="text-link">
                운동 달력 보기
              </Link>
            </Notice>
          )}
          {pending && (
            <Notice tone="info">
              이전 추천 요청의 결과를 확인해야 해요. 같은 요청으로 다시 확인할
              수 있어요.
            </Notice>
          )}
          {(!todayRoutine || pending) && (
            <button
              className="button primary workout-request"
              disabled={busy || remaining > 0}
              onClick={() => void create()}
            >
              {busy
                ? "운동을 준비하고 있어요"
                : remaining
                  ? `${remaining}초 후 다시 시도`
                  : pending
                    ? "이전 추천 요청 확인하기"
                    : "오늘 운동 준비하기"}
            </button>
          )}
          {error !== undefined && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setError(undefined);
                setLoaded(false);
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

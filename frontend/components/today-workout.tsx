"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/http";
import { getCurrentRoutine, requestNextRoutine } from "@/lib/workout-routines";
import { routineWorkouts, type WorkoutRoutine } from "@/lib/workout-routine";
import { shiftDay } from "@/lib/workout-history";
import { assignedWorkoutsForDay } from "@/lib/assigned-workouts";
import { workoutJournal, type WorkoutWriter } from "@/lib/workout-journal";
import { useSession } from "./session-provider";
import { Header, Loading, Notice, Shell } from "./ui";
import { WorkoutError } from "./workout-error";
import { AssignedWorkoutList } from "./assigned-workout-list";
import { useWorkoutHistory } from "./workout-history-provider";

export function TodayWorkout({ embedded = false }: { embedded?: boolean }) {
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
    const lease = workoutJournal.acquire(userId, "routine:next");
    writer.current = lease;
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
      const value = await requestNextRoutine(request.key);
      if (!lease.active()) return;
      lease.save([]);
      setPending(false);
      setCreated(value);
      // A replay may belong to an earlier day. Never relabel it as tomorrow.
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
  const tomorrow = shiftDay(today, 1);
  const next =
    created?.koreanDate === tomorrow
      ? created
      : history.routines.find((row) => row.koreanDate === tomorrow);
  const todayItems = assignedWorkoutsForDay(
    [
      ...history.workouts.filter((row) => !row.routine),
      ...(todayRoutine ? routineWorkouts(todayRoutine) : []),
    ],
    today,
  );
  const content = (
    <div className={embedded ? "stack" : "content stack"}>
      {!loaded ? (
        <Loading />
      ) : (
        <>
          {error !== undefined && <WorkoutError error={error} />}
          {todayItems.length ? (
            <>
              {todayRoutine && (
                <p className="caption">
                  예상 {todayRoutine.estimatedMinutes}분 ·{" "}
                  {todayRoutine.progress.completedItems}/
                  {todayRoutine.progress.totalItems}개 완료
                </p>
              )}
              <AssignedWorkoutList workouts={todayItems} />
              {todayRoutine?.status === "completed" && (
                <Notice tone="success">오늘의 모든 운동을 완료했어요.</Notice>
              )}
            </>
          ) : (
            error === undefined && (
              <p className="muted">
                아직 오늘 배정된 운동이 없어요. 내일 시작할 운동을 준비해
                보세요.
              </p>
            )
          )}
          {next && (
            <section className="feature-card stack-sm" aria-label="내일의 운동">
              <h3>내일의 운동이 준비됐어요</h3>
              <p className="caption">
                {next.koreanDate} · {next.routine.length}개 운동 · 예상{" "}
                {next.estimatedMinutes}분
              </p>
              <ol>
                {next.routine.map((item) => (
                  <li key={item.id}>
                    {item.title} · {item.prescription.text}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {created && created.koreanDate !== tomorrow && (
            <Notice tone="info">
              이전 요청으로 준비한 {created.koreanDate} 운동을 확인했어요.{" "}
              <Link href="/workouts" className="text-link">
                운동 이력 보기
              </Link>
            </Notice>
          )}
          {pending && (
            <Notice tone="info">
              이전 추천 요청의 결과를 확인해야 해요. 같은 요청으로 다시 확인할
              수 있어요.
            </Notice>
          )}
          {(!next || pending) && (
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
                    : "내일 운동 준비하기"}
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

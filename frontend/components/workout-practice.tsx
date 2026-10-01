"use client";
import Link from "next/link";
import { useCallback, useEffect, useReducer } from "react";
import { getRoutine } from "@/lib/workout-routines";
import {
  doseRange,
  initialPractice,
  practiceReducer,
} from "@/lib/workout-practice";
import type { RoutineItem } from "@/lib/workout-routine";
import { errorMessage } from "@/lib/http";
import { useApiResource } from "./use-api-resource";
import { Header, Loading, Notice, Shell } from "./ui";
import { RoutinePrescription } from "./routine-prescription";
import { RoutineNext } from "./routine-next";
import { useUnsaved } from "./use-unsaved";
export function WorkoutPractice({
  routineId,
  itemId,
}: {
  routineId: string;
  itemId: string;
}) {
  const resource = useApiResource(
    useCallback(
      (signal: AbortSignal) => getRoutine(routineId, signal),
      [routineId],
    ),
  );
  const item = resource.data?.routine.find((i) => i.id === itemId);
  return (
    <Shell>
      <Header
        title="처방 따라 하기"
        back={`/workout-routines/${routineId}/items/${itemId}`}
      />
      <div className="content stack">
        {resource.error ? (
          <>
            <Notice>{errorMessage(resource.error)}</Notice>
            <button className="button secondary" onClick={resource.reload}>
              다시 불러오기
            </button>
          </>
        ) : null}
        {item ? (
          <Practice key={itemId} item={item} routineId={routineId} />
        ) : resource.data ? (
          <Notice>이 루틴의 운동을 찾을 수 없어요.</Notice>
        ) : (
          !resource.error && <Loading />
        )}
      </div>
    </Shell>
  );
}
function Practice({
  item,
  routineId,
}: {
  item: RoutineItem;
  routineId: string;
}) {
  const p = item.prescription,
    range = doseRange(p);
  const [state, dispatch] = useReducer(
    (
      s: ReturnType<typeof initialPractice>,
      a: Parameters<typeof practiceReducer>[2],
    ) => practiceReducer(p, s, a),
    p,
    initialPractice,
  );
  const running = state.deadline !== null,
    rest = state.phase === "rest",
    timed = p.doseType !== "reps" && !!range;
  useUnsaved(
    state.phase !== "ready" && state.phase !== "done",
    "선택 운동의 세트 진행은 이 화면에서만 기록돼요. 나갈까요?",
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => dispatch({ type: "tick", now: performance.now() }),
      100,
    );
    const hide = () => {
      if (document.visibilityState !== "visible")
        dispatch({ type: "pause", now: performance.now() });
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [running]);
  return (
    <>
      <div className="intro">
        <p className="eyebrow">
          {p.doseType === "reps"
            ? "반복형"
            : p.doseType === "hold"
              ? "유지형"
              : "시간형"}{" "}
          운동 · 선택
        </p>
        <h1>{item.title}</h1>
      </div>
      <RoutinePrescription prescription={p} />
      <p className="caption">
        영상 시청으로 기록된 운동 완료는 그대로 유지돼요. 이 화면의 수행은
        선택이에요.
      </p>
      {state.phase === "done" ? (
        <div className="reward-result" role="status">
          <span aria-hidden="true">✓</span>
          <h2>{p.sets}세트 모두 마쳤어요!</h2>
          <p>수고했어요. 다음 운동으로 이어가 볼까요?</p>
        </div>
      ) : (
        <>
          <div className="practice-progress" aria-label="세트 진행">
            {Array.from({ length: Math.min(p.sets, 20) }, (_, i) => (
              <span
                key={i}
                className={
                  i < state.set - 1
                    ? "done"
                    : i === state.set - 1
                      ? "current"
                      : ""
                }
              >
                {i + 1}
              </span>
            ))}
          </div>
          <p className="practice-set">
            {state.set} / {p.sets}세트 {rest ? "· 쉬는 시간" : ""}
          </p>
          {range && state.phase === "ready" && (
            <div className="field">
              <label htmlFor="practice-target">
                이번 세트 목표 ({range.min}
                {range.min !== range.max ? `~${range.max}` : ""}
                {p.unit})
              </label>
              <input
                id="practice-target"
                type="number"
                min={range.min}
                max={range.max}
                step="1"
                value={state.target}
                onChange={(e) =>
                  dispatch({ type: "target", value: Number(e.target.value) })
                }
              />
            </div>
          )}
          {!range && (
            <Notice tone="info">
              처방 내용을 확인하고 세트를 마친 뒤 완료 버튼을 눌러 주세요.
            </Notice>
          )}
          <div
            className="practice-counter"
            role="timer"
            aria-label={rest ? "휴식 남은 시간" : "운동 진행"}
          >
            {rest || timed
              ? `${Math.floor(Math.ceil(state.remainingMs / 1000) / 60)}:${String(Math.ceil(state.remainingMs / 1000) % 60).padStart(2, "0")}`
              : range
                ? `${state.reps} / ${state.target}`
                : `${state.set}세트`}
          </div>
          {(state.phase === "ready" || timed || rest) && (
            <button
              className="button primary"
              onClick={() =>
                dispatch({
                  type: running ? "pause" : "start",
                  now: performance.now(),
                })
              }
            >
              {running
                ? "일시정지"
                : state.phase === "ready"
                  ? "세트 시작"
                  : rest
                    ? "휴식 타이머 시작 / 계속"
                    : "타이머 계속"}
            </button>
          )}
          {state.phase === "work" && !timed && (
            <>
              <button
                className="button primary"
                disabled={!!range && state.reps >= state.target}
                onClick={() => dispatch({ type: range ? "rep" : "finish" })}
              >
                {range ? "1회 했어요" : "이번 세트 완료"}
              </button>
              {range && (
                <button
                  className="button secondary"
                  disabled={state.reps < state.target}
                  onClick={() => dispatch({ type: "finish" })}
                >
                  이번 세트 완료
                </button>
              )}
            </>
          )}
          {rest && (
            <button
              className="button secondary"
              onClick={() => dispatch({ type: "skipRest" })}
            >
              휴식 마치고 다음 세트
            </button>
          )}
        </>
      )}
      <button
        className="text-button"
        onClick={() => {
          if (window.confirm("선택 운동을 1세트부터 다시 시작할까요?"))
            dispatch({ type: "reset" });
        }}
      >
        세트 다시 시작
      </button>
      <RoutineNext routineId={routineId} itemId={item.id} practice={false} />
      <Link
        href={`/workout-routines/${routineId}/items/${item.id}`}
        className="text-link"
      >
        안내 영상 다시 보기
      </Link>
    </>
  );
}

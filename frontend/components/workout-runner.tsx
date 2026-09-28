"use client";
import { useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  RotateCcw,
  Volume2,
  VolumeX,
  ExternalLink,
  Check,
  SkipForward,
} from "lucide-react";
import {
  resultError,
  resultValue,
  type WorkoutDefinition,
  type WorkoutState,
  type WorkoutAction,
} from "@/lib/workout";
import { FieldError, Notice } from "./ui";
import {
  useWorkoutTicker,
  useWorkoutSound,
  WorkoutTimer,
} from "./workout-timer";

type Props = {
  definition: WorkoutDefinition;
  state: WorkoutState;
  dispatch: (action: WorkoutAction) => void;
  disabled?: boolean;
};
export function WorkoutRunner({
  definition,
  state,
  dispatch,
  disabled = false,
}: Props) {
  const [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const step = definition.steps[state.index];
  const segment = step.segments[state.segmentIndex];
  const running = state.phase === "countdown" || state.phase === "active";
  const reviewing = state.phase === "review";
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, [state.index, reviewing]);
  useWorkoutTicker(running, dispatch);
  const { sound, audioError, toggleSound, cue } = useWorkoutSound(
    state,
    segment,
  );
  function act(action: WorkoutAction) {
    setError("");
    dispatch(action);
  }
  if (state.phase === "review")
    return (
      <section className="stack" aria-labelledby="workout-review-title">
        <div className="intro">
          <span className="eyebrow">MEASUREMENT COMPLETE</span>
          <h2 id="workout-review-title" ref={title} tabIndex={-1}>
            측정한 값을 확인해요
          </h2>
          <p>건너뛴 항목은 기록에 포함되지 않아요.</p>
        </div>
        <div className="assessment-results">
          {definition.steps.map((item, index) => (
            <div className="assessment-result" key={item.id}>
              <div>
                <span className="caption">{item.factor}</span>
                <h3>{item.title}</h3>
                <strong>
                  {state.results[item.id] !== undefined
                    ? `${resultValue(item, state.results[item.id])} ${item.result.storedUnit}`
                    : "건너뜀"}
                </strong>
              </div>
              <button
                type="button"
                className="icon-button"
                disabled={disabled}
                aria-label={`${item.title} 다시 측정`}
                onClick={() => act({ type: "repeat", index })}
              >
                <RotateCcw size={18} />
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  return (
    <div className="stack">
      <ol className="assessment-steps" aria-label="측정 순서">
        {definition.steps.map((item, index) => (
          <li
            key={item.id}
            aria-current={index === state.index ? "step" : undefined}
          >
            <span>
              {item.id in state.results ? (
                <Check size={16} />
              ) : state.skipped.includes(item.id) ? (
                <SkipForward size={14} />
              ) : (
                index + 1
              )}
            </span>
            <small>{item.factor}</small>
          </li>
        ))}
      </ol>
      <section
        className={`workout-stage stack ${running ? "running" : ""}`}
        aria-labelledby="workout-title"
      >
        <div className="between">
          <span className="eyebrow">
            {String(state.index + 1).padStart(2, "0")} /{" "}
            {String(definition.steps.length).padStart(2, "0")} · {step.factor}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={sound ? "안내 소리 끄기" : "안내 소리 켜기"}
            aria-pressed={sound}
            onClick={() => void toggleSound()}
          >
            {sound ? <Volume2 size={21} /> : <VolumeX size={21} />}
          </button>
        </div>
        <h2 id="workout-title" ref={title} tabIndex={-1}>
          {step.title}
        </h2>
        {audioError && <p className="caption">{audioError}</p>}
        {running ? (
          <>
            <p className="workout-stage-label" role="status">
              {state.phase === "countdown"
                ? "자세를 준비해 주세요"
                : segment.title}
            </p>
            <WorkoutTimer
              phase={state.phase === "countdown" ? "countdown" : "active"}
              remainingMs={state.remainingMs}
              elapsedMs={state.elapsedMs}
              segment={segment}
            />
            {cue && (
              <div className="cadence-cue">
                <b>{cue}</b>
                <span>
                  {segment.cadence?.intervalMs === 625
                    ? "96 BPM · 네 박자 반복"
                    : "3초 간격 · 자세를 지켜 주세요"}
                </span>
              </div>
            )}
            {step.segments.length > 1 && (
              <div className="segment-track">
                {step.segments.map((s, i) => (
                  <span
                    className={i === state.segmentIndex ? "active" : ""}
                    key={s.id}
                  >
                    {s.shortLabel ?? s.title}
                  </span>
                ))}
              </div>
            )}
            {state.phase === "active" && segment.canFinish && (
              <button
                className="button primary"
                onClick={() => act({ type: "finish", now: Date.now() })}
              >
                측정 종료 · 횟수 입력
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => act({ type: "interrupt" })}
            >
              <Square size={17} />
              측정 중단
            </button>
            <p className="caption center">
              화면을 켜 둔 채 진행해 주세요. 중단하면 이 항목을 다시 측정해요.
            </p>
          </>
        ) : (
          <>
            {state.phase === "interrupted" && (
              <Notice tone="info">
                측정이 중단됐어요. 정확한 시간 기준을 위해 이 항목은 처음부터
                다시 측정해 주세요. 앞서 입력한 값은 유지돼요.
              </Notice>
            )}
            {(state.phase === "ready" || state.phase === "interrupted") && (
              <>
                <div className="equipment-list">
                  {step.equipment.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <ol className="exercise-guide">
                  {step.instructions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
                <a
                  className="text-link workout-video"
                  href={step.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={16} />
                  국민체력100 동영상 안내
                </a>
                <button
                  className="button primary"
                  onClick={() => act({ type: "start", now: Date.now() })}
                >
                  <Play size={19} />
                  {step.segments.length
                    ? state.phase === "interrupted"
                      ? "이 항목 다시 시작"
                      : "측정 시작"
                    : "측정값 입력"}
                </button>
              </>
            )}
            {state.phase === "record" && (
              <form
                className="stack"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  const problem = resultError(step, state.draftValue);
                  setError(problem ?? "");
                  if (!problem)
                    act({ type: "record", value: state.draftValue });
                }}
              >
                <p className="muted">{step.result.hint}</p>
                <div className="field">
                  <label htmlFor="workout-result">
                    {step.result.label} ({step.result.unit})
                  </label>
                  <input
                    id="workout-result"
                    type="text"
                    inputMode={
                      step.result.minimum === undefined
                        ? "text"
                        : step.result.kind === "integer"
                          ? "numeric"
                          : "decimal"
                    }
                    maxLength={16}
                    autoComplete="off"
                    value={state.draftValue}
                    onChange={(e) =>
                      act({ type: "input", value: e.target.value })
                    }
                    aria-invalid={!!error}
                    aria-describedby="result-hint workout-error"
                  />
                  <p className="caption" id="result-hint">
                    {step.result.multiplier &&
                    !resultError(step, state.draftValue)
                      ? `분당 심박수 ${resultValue(step, state.draftValue)} bpm으로 저장돼요.`
                      : "측정하지 않았다면 건너뛰기를 선택해 주세요."}
                  </p>
                  <FieldError id="workout-error" message={error} />
                </div>
                <button className="button primary">
                  {state.reviewing ||
                  state.index === definition.steps.length - 1
                    ? "결과 확인"
                    : "입력하고 다음으로"}
                </button>
                {step.segments.length > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => act({ type: "restart" })}
                  >
                    이 항목 다시 측정
                  </button>
                )}
              </form>
            )}
            <button
              className="text-button"
              onClick={() => act({ type: "skip" })}
            >
              이 항목 건너뛰기
            </button>
          </>
        )}
      </section>
    </div>
  );
}

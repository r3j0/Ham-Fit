"use client";
import Link from "next/link";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Dumbbell,
  Pause,
  Play,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useUserProfile } from "./user-profile-provider";
import { Dialog, Header, Loading, Notice, Shell } from "./ui";
import { useUnsaved } from "./use-unsaved";
import {
  useWorkoutSound,
  useWorkoutTicker,
  WorkoutTimer,
  formatWorkoutTime,
} from "./workout-timer";
import { assessmentHref } from "@/lib/workout-mode";
import {
  advanceRoutine,
  initialRoutine,
  previewRoutine,
  exerciseTarget,
  exerciseSegment,
  restSegment,
  type WorkoutRoutine,
  type RoutineExercise,
  type RoutineState,
  type RoutineAction,
} from "@/lib/workout-routine";
import styles from "./workout-overview.module.css";

export function WorkoutOverview({
  unsupported = false,
}: {
  unsupported?: boolean;
}) {
  if (unsupported)
    return (
      <Shell>
        <Header title="운동" />
        <div className="content stack">
          <Notice>지원하지 않는 운동 과정이에요.</Notice>
          <Link className="button secondary" href={assessmentHref}>
            성인 간이측정 열기
          </Link>
          <Link className="text-link" href="/workout">
            오늘의 운동으로
          </Link>
        </div>
      </Shell>
    );
  return <RoutineWorkout routine={previewRoutine} />;
}

function ExerciseGuide({ exercise }: { exercise: RoutineExercise }) {
  return (
    <details className={styles.guide}>
      <summary>
        동작 안내 <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <ol>
        {exercise.instructions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </details>
  );
}

/** Only the routine definition needs replacing when assigned exercises are available. */
function RoutineWorkout({ routine }: { routine: WorkoutRoutine }) {
  const profile = useUserProfile();
  const assignment = profile.data?.currentCurriculum;
  const [started, setStarted] = useState(false);
  const [dialog, setDialog] = useState<"end" | "skip" | null>(null);
  const [state, dispatch] = useReducer(
    (current: RoutineState, action: RoutineAction) =>
      advanceRoutine(routine, current, action),
    routine,
    initialRoutine,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const exercise = routine.exercises[state.index];
  const complete = state.phase === "complete";
  const running = ["countdown", "active", "rest"].includes(state.phase);
  const showingPhase =
    state.phase === "paused" ? state.pausedPhase : state.phase;
  // Rest belongs to the preceding set, even when the next exercise is selected.
  const resting = showingPhase === "rest";
  const restSeconds =
    state.completedSets[state.index] === 0 && state.index > 0
      ? routine.exercises[state.index - 1].restSeconds
      : exercise.restSeconds;
  const segment = resting
    ? restSegment(restSeconds)
    : exerciseSegment(exercise);
  const completed = state.completedSets.reduce((sum, count) => sum + count, 0);
  const total = routine.exercises.reduce((sum, item) => sum + item.sets, 0);
  useWorkoutTicker(running, dispatch);
  const { sound, audioError, toggleSound } = useWorkoutSound(
    {
      index: state.index,
      segmentIndex: state.completedSets[state.index],
      phase: state.phase === "rest" || complete ? "record" : state.phase,
      elapsedMs: state.elapsedMs,
    },
    segment,
  );
  useUnsaved(
    started && !complete,
    "진행 중인 운동이 초기화돼요. 이 화면을 나갈까요?",
  );
  useEffect(() => {
    if (started) heading.current?.focus({ preventScroll: true });
  }, [started, state.index, state.phase]);

  function act(type: RoutineAction["type"]) {
    dispatch({ type, now: Date.now() });
  }
  function askToEnd() {
    act("interrupt");
    setDialog("end");
  }

  if (!started)
    return (
      <Shell className={styles.shell}>
        <Header title="오늘의 운동" />
        <div className={`content stack ${styles.content}`}>
          <section
            className={styles.hero}
            aria-labelledby="today-workout-title"
          >
            <div className="between">
              <span className={styles.eyebrow}>TODAY</span>
              <span className={styles.badge}>체험 운동</span>
            </div>
            <h2 id="today-workout-title">
              {routine.title}
              <br />
              가볍게 시작해요
            </h2>
            <p>
              {routine.exercises.length}개 운동 · 총 {total}세트 · 맨몸 중심
            </p>
            <div className={styles.heroGoal}>
              <span>오늘 목표</span>
              <strong>0 / {total}세트</strong>
            </div>
            <div className={styles.heroTrack} aria-hidden="true" />
            <button
              className={`button ${styles.start}`}
              onClick={() => {
                setStarted(true);
                act("start");
              }}
            >
              운동 시작 <ArrowRight size={19} aria-hidden="true" />
            </button>
          </section>
          <section aria-labelledby="routine-list-title">
            <div className={styles.sectionHeading}>
              <h2 id="routine-list-title">이 순서로 운동해요</h2>
              <span>세트 사이 30초 휴식</span>
            </div>
            <ol className={styles.exerciseList}>
              {routine.exercises.map((item, index) => (
                <li key={item.id} className={styles.exerciseCard}>
                  <div className={styles.exerciseRow}>
                    <span className={styles.number} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <span className={styles.focus}>
                        {item.focus} · {item.equipment.join(" · ")}
                      </span>
                      <h3>{item.title}</h3>
                    </div>
                    <p>
                      <strong>{exerciseTarget(item)}</strong>
                      <span>× {item.sets}세트</span>
                    </p>
                  </div>
                  <ExerciseGuide exercise={item} />
                </li>
              ))}
            </ol>
          </section>
          <p className={styles.note}>
            내 속도에 맞춰 진행하고, 세트를 마치면 완료를 눌러 주세요. 불편하면
            언제든 쉬거나 건너뛸 수 있어요.
          </p>
          <section className={styles.assignment} aria-label="현재 배정 정보">
            <span className="caption">내 배정 운동</span>
            {profile.status === "loading" && (
              <Loading label="배정 정보를 불러오는 중이에요" />
            )}
            {profile.error && (
              <>
                <Notice>{profile.error}</Notice>
                <button className="text-button" onClick={profile.reload}>
                  다시 불러오기
                </button>
              </>
            )}
            {profile.data && (
              <div className="between">
                <h3>
                  {assignment?.curriculum.name ?? "아직 배정된 운동이 없어요"}
                </h3>
                {assignment && (
                  <span className="status-badge">
                    {assignment.status === "completed" ? "완료" : "배정됨"}
                  </span>
                )}
              </div>
            )}
            <p className="caption">
              위 체험 운동은 배정 운동과 별개이며, 운동 기록에 저장되지 않아요.
              화면을 새로 열면 처음부터 시작해요.
            </p>
          </section>
          <Link className={`text-link ${styles.recordLink}`} href="/onboarding">
            체력 기록 시작하기
          </Link>
        </div>
      </Shell>
    );

  return (
    <Shell
      className={`${styles.shell} ${styles.session} workout-session-shell`}
    >
      <Header
        title={complete ? "운동 완료" : "운동 중"}
        onBack={complete ? undefined : askToEnd}
        back={complete ? "/" : undefined}
        right={
          complete ? undefined : (
            <button
              className="icon-button"
              aria-label={sound ? "안내 소리 끄기" : "안내 소리 켜기"}
              aria-pressed={sound}
              onClick={() => void toggleSound()}
            >
              {sound ? <Volume2 size={21} /> : <VolumeX size={21} />}
            </button>
          )
        }
      />
      <div className={`content stack ${styles.content}`}>
        {complete ? (
          <>
            <div className={styles.completionHero}>
              <div className={styles.completionIcon}>
                {completed > 0 ? (
                  <CheckCircle2 size={48} aria-hidden="true" />
                ) : (
                  <Dumbbell size={48} aria-hidden="true" />
                )}
              </div>
              <span className="eyebrow">WORKOUT COMPLETE</span>
              <h2 ref={heading} tabIndex={-1}>
                {completed === total
                  ? "운동을 마쳤어요"
                  : "운동을 마무리했어요"}
              </h2>
              <p>
                {completed === total
                  ? "준비한 모든 세트를 완료했어요."
                  : completed
                    ? "오늘 완료한 세트를 확인해 보세요."
                    : "오늘은 여기까지. 다음에 다시 시작해요."}
              </p>
            </div>
            <dl className={styles.summary}>
              <div>
                <dt>완료한 세트</dt>
                <dd>
                  {completed}
                  <small> / {total}세트</small>
                </dd>
              </div>
              <div>
                <dt>완료 세트 시간</dt>
                <dd>{formatWorkoutTime(state.exerciseMs)}</dd>
              </div>
            </dl>
            <ul className={styles.results} aria-label="운동 결과">
              {routine.exercises.map((item, index) => (
                <li key={item.id}>
                  <span
                    className={
                      state.completedSets[index] === item.sets
                        ? styles.doneIcon
                        : styles.skippedIcon
                    }
                  >
                    {state.completedSets[index] === item.sets ? (
                      <Check size={20} aria-hidden="true" />
                    ) : (
                      <SkipForward size={20} aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>
                      {state.completedSets[index]} / {item.sets}세트
                      {state.skipped.includes(item.id)
                        ? " · 나머지 건너뜀"
                        : " · 완료"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className={`${styles.note} center`}>
              체험 운동은 운동 기록에 저장되지 않아요.
            </p>
            <Link href="/" className="button primary">
              메인으로 돌아가기 <ArrowRight size={19} aria-hidden="true" />
            </Link>
          </>
        ) : (
          <>
            <div className={styles.progress}>
              <div className="between">
                <span>전체 진행</span>
                <strong>
                  {completed} / {total}세트
                </strong>
              </div>
              <progress
                aria-label="운동 세트 진행"
                max={total}
                value={completed}
              />
            </div>
            <ol className={styles.steps} aria-label="운동 순서">
              {routine.exercises.map((item, index) => (
                <li
                  key={item.id}
                  aria-current={index === state.index ? "step" : undefined}
                >
                  <span>
                    {state.completedSets[index] === item.sets ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  {item.title}
                </li>
              ))}
            </ol>
            <section
              data-phase={state.phase}
              className={styles.stage}
              aria-labelledby="routine-exercise-title"
            >
              <div className={styles.stageHeading}>
                <span className={styles.focus}>
                  {resting
                    ? "다음 세트"
                    : `${exercise.focus} · ${state.index + 1} / ${routine.exercises.length}`}
                </span>
                <h2 id="routine-exercise-title" ref={heading} tabIndex={-1}>
                  {exercise.title}
                </h2>
                <p>
                  <strong>{exerciseTarget(exercise)}</strong>
                  <span>
                    {state.completedSets[state.index] + 1} / {exercise.sets}세트
                  </span>
                </p>
              </div>
              <p className={styles.phase} role="status">
                {state.phase === "paused"
                  ? "잠시 멈췄어요"
                  : resting
                    ? "잠깐, 편하게 쉬어요"
                    : state.phase === "countdown"
                      ? "자세를 준비해 주세요"
                      : state.phase === "ready"
                        ? "준비되면 다음 세트를 시작해요"
                        : "내 속도에 맞춰 움직여요"}
              </p>
              {state.phase === "ready" ? (
                <div className={styles.readyIcon}>
                  <Dumbbell size={64} strokeWidth={1.5} aria-hidden="true" />
                  <span>준비됐나요?</span>
                </div>
              ) : (
                <WorkoutTimer
                  phase={showingPhase === "countdown" ? "countdown" : "active"}
                  remainingMs={state.remainingMs}
                  elapsedMs={state.elapsedMs}
                  segment={segment}
                />
              )}
              <p className={styles.stageHint}>
                {state.phase === "paused"
                  ? "시간과 세트는 그대로예요. 준비되면 이어서 진행해요."
                  : resting
                    ? "휴식이 끝나도 운동은 자동으로 시작되지 않아요."
                    : exercise.target.kind === "time"
                      ? "표시된 시간 동안 내 속도에 맞춰 진행해요."
                      : `${exerciseTarget(exercise)}를 마치면 세트 완료를 눌러 주세요.`}
              </p>
              {audioError && (
                <p className="caption" role="status">
                  {audioError}
                </p>
              )}
              <div className={styles.controls}>
                {state.phase === "active" &&
                  exercise.target.kind === "reps" && (
                    <button
                      className="button primary"
                      onClick={() => act("finish-set")}
                    >
                      <Check size={19} aria-hidden="true" />
                      세트 완료
                    </button>
                  )}
                {state.phase === "ready" && (
                  <button
                    className="button primary"
                    onClick={() => act("start")}
                  >
                    <Play size={19} aria-hidden="true" />
                    {state.completedSets[state.index] + 1}세트 시작
                  </button>
                )}
                {state.phase === "paused" && (
                  <button
                    className="button primary"
                    onClick={() => act("resume")}
                  >
                    <Play size={19} aria-hidden="true" />
                    이어서 운동하기
                  </button>
                )}
                {resting && (
                  <button
                    className={
                      state.phase === "paused"
                        ? "button secondary"
                        : "button primary"
                    }
                    onClick={() => act("skip-rest")}
                  >
                    휴식 끝내기 <ArrowRight size={19} aria-hidden="true" />
                  </button>
                )}
                {running && (
                  <button
                    className="button secondary"
                    onClick={() => act("interrupt")}
                  >
                    <Pause size={19} aria-hidden="true" />
                    일시정지
                  </button>
                )}
              </div>
            </section>
            <ExerciseGuide key={exercise.id} exercise={exercise} />
            {(state.phase === "ready" || state.phase === "paused") && (
              <button className="text-button" onClick={() => setDialog("skip")}>
                이 운동 건너뛰기
              </button>
            )}
            <button className="text-button" onClick={askToEnd}>
              운동 마무리하기
            </button>
          </>
        )}
      </div>
      {dialog && (
        <Dialog
          title={
            dialog === "end"
              ? "운동을 여기서 마칠까요?"
              : `${exercise.title}을 건너뛸까요?`
          }
          onClose={() => setDialog(null)}
        >
          <div className="stack">
            <p className="muted">
              완료한 세트는 결과에 남고, 남은 세트는 완료로 표시하지 않아요.
            </p>
            <button
              className="button primary"
              onClick={() => {
                act(dialog === "end" ? "end" : "skip-exercise");
                setDialog(null);
              }}
            >
              {dialog === "end" ? "운동 마무리" : "건너뛰기"}
            </button>
            <button
              className="button secondary"
              onClick={() => setDialog(null)}
            >
              계속 운동하기
            </button>
          </div>
        </Dialog>
      )}
    </Shell>
  );
}

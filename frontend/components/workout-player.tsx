"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkoutHistoryLinks } from "./use-workout-history-links";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { completedDate } from "@/lib/workout-history";
import { ApiError, errorMessage } from "@/lib/http";
import {
  createPlaybackSession,
  samplePlayback,
  hasWatchedEnough,
} from "@/lib/playback-session";
import { workoutJournal } from "@/lib/workout-journal";
import { getWorkout, sendWorkoutEvent } from "@/lib/workouts";
import type { Workout } from "@/lib/workout-types";
import { useSession } from "./session-provider";
import { Dialog, Notice } from "./ui";
import { useUnsaved } from "./use-unsaved";
import { WorkoutError } from "./workout-error";
import { useWorkoutHistory } from "./workout-history-provider";
import { WorkoutSummary } from "./workout-summary";
import { RoutineNext } from "./routine-next";
import { RoutineExerciseGuide } from "./routine-exercise-guide";
import styles from "./workout-player.module.css";
import { getRoutine } from "@/lib/workout-routines";
import { afterRoutineItemHref } from "@/lib/workout-practice";

export function WorkoutPlayer({
  initial,
  replay = false,
}: {
  initial: Workout;
  replay?: boolean;
}) {
  const { basePath, overviewHref } = useWorkoutHistoryLinks();
  const userId = useSession().user!.id;
  const router = useRouter();
  const advanceAfterStop = useRef(false);
  const [navigationRequested, setNavigationRequested] = useState(false);
  const [advanceError, setAdvanceError] = useState("");
  const [advanceRetry, setAdvanceRetry] = useState(0);
  const [session] = useState(() =>
    createPlaybackSession({
      initial,
      acquire: () => {
        const writer = workoutJournal.acquire(userId, initial.id);
        if (
          initial.routine &&
          !replay &&
          writer.read().some((request) => {
            try {
              return ["end", "complete"].includes(
                JSON.parse(request.body).type,
              );
            } catch {
              return false;
            }
          })
        ) {
          queueMicrotask(() => setNavigationRequested(true));
        }
        return writer;
      },
      send: (key, body) => sendWorkoutEvent(initial.id, key, body),
      fetch: () => getWorkout(initial.id),
    }),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const { workout } = state;
  const readOnly = !!workout.routine && !state.recordingAllowed;
  const video = useRef<HTMLVideoElement>(null);
  const restored = useRef(false);
  const lastSave = useRef(0);
  const suppressPause = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [confirm, setConfirm] = useState<"end" | "complete" | "reset" | null>(
    null,
  );
  const actionBlocked =
    !state.connected ||
    state.recovering ||
    state.error !== undefined ||
    state.terminalPending;
  const advancing =
    !!workout.routine &&
    !replay &&
    !readOnly &&
    (navigationRequested ||
      (workout.status === "completed" && initial.status !== "completed"));
  const canPlay =
    readOnly ||
    (!advancing &&
      state.connected &&
      !state.recovering &&
      state.error === undefined);
  const verified =
    workout.video.playbackStatus === "verified" && !!workout.video.playbackUrl;
  const completed = workout.status === "completed";
  const completedDay = completedDate(workout);
  const { reload: reloadHistory } = useWorkoutHistory();
  useEffect(() => {
    if (navigationRequested) advanceAfterStop.current = true;
  }, [navigationRequested]);
  useEffect(() => {
    if (completed) reloadHistory();
  }, [completed, reloadHistory]);
  useEffect(() => {
    if (
      !advancing ||
      !state.connected ||
      state.saving ||
      state.pending ||
      state.recovering ||
      state.error !== undefined ||
      !workout.routine ||
      !["completed", "interrupted", "not_performed"].includes(workout.status)
    )
      return;
    const controller = new AbortController();
    getRoutine(workout.routine.id, controller.signal)
      .then((row) => {
        if (!controller.signal.aborted)
          router.replace(afterRoutineItemHref(row, workout.routine!.itemId));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setAdvanceError(errorMessage(error));
      });
    return () => controller.abort();
  }, [
    advancing,
    state.connected,
    state.saving,
    state.pending,
    state.recovering,
    state.error,
    workout.routine,
    workout.status,
    router,
    advanceRetry,
  ]);
  useUnsaved(
    (playing && !completed && !readOnly) || state.pending > 0,
    "운동 진행을 저장하고 있어요. 이 화면을 나가면 재생을 멈추고, 미확정 저장은 돌아온 뒤 다시 확인해요. 나갈까요?",
  );
  useEffect(() => {
    session.connect();
    const mountedMedia = video.current;
    const capturePause = () => {
      const media = video.current ?? mountedMedia;
      if (!media) return;
      if (session.getSnapshot().workout.routine && !session.canRecord()) return;
      // Synchronous journaling survives pagehide even when the request cannot finish.
      suppressPause.current = true;
      media.pause();
      if (
        restored.current &&
        session.getSnapshot().workout.status === "in_progress"
      )
        void session.record(
          "pause",
          samplePlayback(media, session.getSnapshot().workout),
        );
      suppressPause.current = false;
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") capturePause();
      else void session.refresh();
    };
    window.addEventListener("pagehide", capturePause);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      capturePause();
      session.disconnect();
      window.removeEventListener("pagehide", capturePause);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session]);
  // Preserve newer server revisions without recreating an active playback session.
  useEffect(() => {
    if (initial.revision > session.getSnapshot().workout.revision)
      void session.refresh();
  }, [initial, session]);
  useEffect(() => {
    if (!canPlay) video.current?.pause();
  }, [canPlay]);
  useEffect(() => {
    if (completed && !readOnly) {
      video.current?.pause();
      if (video.current) video.current.currentTime = 0;
    }
  }, [completed, readOnly]);
  useEffect(() => {
    const media = video.current;
    if (
      !state.recovering &&
      !restored.current &&
      media &&
      media.readyState >= 1 &&
      Number.isFinite(media.duration)
    ) {
      media.currentTime = Math.min(
        state.workout.status === "completed"
          ? 0
          : state.workout.progress.positionSeconds,
        media.duration,
      );
      restored.current = true;
    }
  }, [
    state.recovering,
    state.workout.progress.positionSeconds,
    state.workout.status,
  ]);
  function capture(type: "progress" | "pause") {
    const media = video.current;
    // The journal also queues a pause behind an unacknowledged native start.
    if (media)
      void session.record(
        type,
        samplePlayback(media, session.getSnapshot().workout),
      );
  }
  async function start() {
    if (readOnly) return;
    if (state.saving || state.pending || state.error !== undefined || !verified)
      return;
    await session.record("start", {
      positionSeconds: workout.progress.positionSeconds,
      intervals: [],
    });
    if (
      session.getSnapshot().error !== undefined ||
      session.getSnapshot().workout.status !== "in_progress"
    )
      return;
    const media = video.current;
    if (media && media.readyState >= 1 && Number.isFinite(media.duration)) {
      media.currentTime = Math.min(
        session.getSnapshot().workout.progress.positionSeconds,
        media.duration,
      );
    }
    // Some mobile browsers require another gesture after awaiting the API; native controls remain available.
    await video.current?.play().catch(() => {});
  }
  async function playFromControls() {
    const media = video.current;
    if (!media) return;
    if (advanceAfterStop.current) {
      media.pause();
      return;
    }
    if (session.getSnapshot().workout.routine) session.canRecord();
    // Finish a native pause before starting again, preserving its original request.
    if (session.getSnapshot().terminalPending) await session.retry();
    if (media.paused) return;
    let latest = session.getSnapshot();
    const viewingOnly = latest.workout.routine && !latest.recordingAllowed;
    if (
      !viewingOnly &&
      (!latest.connected ||
        latest.recovering ||
        latest.error !== undefined ||
        latest.terminalPending)
    ) {
      media.pause();
      return;
    }
    setPlaying(true);
    lastSave.current = performance.now();
    if (
      !viewingOnly &&
      !["in_progress", "completed"].includes(latest.workout.status)
    ) {
      // Native controls can resume an interrupted routine without another button.
      await session.record("start", samplePlayback(media, latest.workout));
      latest = session.getSnapshot();
      if (latest.error !== undefined || latest.workout.status !== "in_progress")
        media.pause();
    }
  }
  async function finalize(type: "end" | "complete") {
    if (session.getSnapshot().workout.routine && !session.canRecord()) {
      setConfirm(null);
      return;
    }
    const media = video.current;
    if (media && !media.paused) {
      suppressPause.current = true;
      media.pause();
    }
    if (workout.routine && !replay) {
      advanceAfterStop.current = true;
      setNavigationRequested(true);
    }
    setConfirm(null);
    // A native pause can already be queued when an ended video is confirmed.
    if (session.getSnapshot().terminalPending) await session.retry();
    if (session.getSnapshot().error !== undefined) return;
    const saved = session.getSnapshot().workout;
    const sample = media
      ? samplePlayback(media, saved)
      : { positionSeconds: saved.progress.positionSeconds, intervals: [] };
    await session.record(type, sample);
  }
  function requestStop() {
    const saved = session.getSnapshot().workout;
    const media = video.current;
    if (saved.routine && !session.canRecord()) return;
    const sample = media
      ? samplePlayback(media, saved)
      : { positionSeconds: saved.progress.positionSeconds, intervals: [] };
    if (media && !media.paused) {
      suppressPause.current = true;
      media.pause();
    }
    if (saved.routine && hasWatchedEnough(saved, sample)) void finalize("end");
    else setConfirm("end");
  }
  function closeConfirmation() {
    if (workout.routine && (confirm === "end" || confirm === "complete"))
      capture("pause");
    setConfirm(null);
  }
  const rejected =
    state.error instanceof ApiError &&
    [400, 409, 404].includes(state.error.status);
  return (
    <div className="stack">
      <WorkoutSummary workout={workout} />
      {readOnly && (
        <Notice tone="info">
          지난 루틴의 시청은 운동 기록에 반영되지 않습니다.
        </Notice>
      )}
      {completed && !replay && !advancing && (
        <Notice tone="success">
          운동을 완료했어요. 영상을 다시 볼 수 있고, 완료한 운동의 기록은
          변경되지 않아요.
        </Notice>
      )}
      {state.error !== undefined && <WorkoutError error={state.error} />}
      {advancing && !advanceError && state.error === undefined && (
        <p className="caption" role="status">
          운동 기록을 확인하고 다음 영상으로 이동하고 있어요.
        </p>
      )}
      {advanceError && (
        <Notice>
          {advanceError}
          <button
            className="button secondary"
            onClick={() => {
              setAdvanceError("");
              setAdvanceRetry((value) => value + 1);
            }}
          >
            다음 운동 다시 확인하기
          </button>
        </Notice>
      )}
      {state.pending > 0 && (state.recovering || state.error !== undefined) && (
        <Notice tone="info">
          {state.recovering && state.saving
            ? "이전에 저장하지 못한 운동 진행을 복구하고 있어요."
            : "아직 확인하지 못한 저장 요청이 있어요. 같은 내용으로 다시 확인해 주세요."}
        </Notice>
      )}
      {state.error !== undefined && (
        <button
          className="button secondary"
          disabled={state.saving}
          onClick={() => void session.retry()}
        >
          저장 다시 확인하기
        </button>
      )}
      {rejected && (
        <button
          className="text-button"
          disabled={state.saving}
          onClick={() => setConfirm("reset")}
        >
          서버에 저장된 상태로 돌아가기
        </button>
      )}
      {!verified ? (
        <div
          className={styles.mediaLayout}
          data-with-guide={workout.routine ? true : undefined}
        >
          <div className="stack">
            <Notice tone="info">
              {workout.video.playbackStatus === "duration_mismatch"
                ? "영상 길이를 확인하지 못해 재생할 수 없어요."
                : "현재 이 영상을 재생할 수 없어요."}{" "}
              잠시 후 다시 확인해 주세요.
            </Notice>
            <button
              className="button secondary"
              disabled={state.saving}
              onClick={() => void session.refresh()}
            >
              영상 다시 확인하기
            </button>
          </div>
          {workout.routine && (
            <RoutineExerciseGuide prescription={workout.routine.prescription} />
          )}
        </div>
      ) : (
        <>
          <div
            className={styles.mediaLayout}
            data-with-guide={workout.routine ? true : undefined}
          >
            <video
              ref={video}
              className="workout-video"
              src={workout.video.playbackUrl!}
              controls={canPlay}
              playsInline
              preload="metadata"
              aria-label="운동 영상"
              onLoadedMetadata={(event) => {
                if (restored.current || session.getSnapshot().recovering)
                  return;
                const media = event.currentTarget;
                const saved = session.getSnapshot().workout;
                const position =
                  saved.status === "completed"
                    ? 0
                    : saved.progress.positionSeconds;
                if (Number.isFinite(media.duration))
                  media.currentTime = Math.min(position, media.duration);
                restored.current = true;
              }}
              onPlay={() => void playFromControls()}
              onPause={() => {
                setPlaying(false);
                if (!suppressPause.current) capture("pause");
                suppressPause.current = false;
              }}
              onTimeUpdate={() => {
                if (
                  video.current?.paused ||
                  performance.now() - lastSave.current < 5000
                )
                  return;
                lastSave.current = performance.now();
                capture("progress");
              }}
              onSeeked={() => {
                if (session.getSnapshot().workout.status === "in_progress")
                  capture("progress");
              }}
              onEnded={() => {
                setPlaying(false);
                if (workout.routine && !replay && !readOnly) requestStop();
                else capture("pause");
              }}
              onError={() => {
                setMediaError(
                  "영상을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.",
                );
                video.current?.pause();
              }}
            />
            {workout.routine && (
              <RoutineExerciseGuide
                prescription={workout.routine.prescription}
              />
            )}
          </div>
          {mediaError && (
            <>
              <Notice>{mediaError}</Notice>
              <button
                className="button secondary"
                onClick={() => {
                  setMediaError("");
                  restored.current = false;
                  video.current?.load();
                }}
              >
                영상 다시 불러오기
              </button>
            </>
          )}
          {!readOnly &&
            !completed &&
            !advancing &&
            workout.status !== "in_progress" && (
              <button
                className="button primary"
                disabled={
                  !state.connected ||
                  state.saving ||
                  state.pending > 0 ||
                  state.error !== undefined ||
                  !!mediaError
                }
                onClick={() => void start()}
              >
                {workout.status === "assigned"
                  ? "운동 시작"
                  : "이어서 운동하기"}
              </button>
            )}
          {!readOnly &&
            !completed &&
            !advancing &&
            (workout.status === "in_progress" ||
              (workout.routine &&
                ["interrupted", "not_performed"].includes(workout.status))) && (
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={actionBlocked}
                  onClick={requestStop}
                >
                  여기서 종료
                </button>
                {!workout.routine && (
                  <button
                    className="button primary"
                    disabled={actionBlocked}
                    onClick={() => {
                      if (video.current && !video.current.paused) {
                        suppressPause.current = true;
                        video.current.pause();
                      }
                      setConfirm("complete");
                    }}
                  >
                    운동 완료
                  </button>
                )}
              </div>
            )}
        </>
      )}
      {completed && !replay && !advancing && workout.routine && (
        <RoutineNext
          routineId={workout.routine.id}
          itemId={workout.routine.itemId}
        />
      )}
      {(completed || readOnly) &&
        !(completed && !replay && workout.routine) && (
          <Link
            className="button primary"
            href={
              readOnly
                ? overviewHref
                : replay && completedDay
                  ? `${basePath}/history/${completedDay}`
                  : replay
                    ? overviewHref
                    : "/workout"
            }
          >
            {readOnly || replay ? "운동 기록으로" : "운동 목록으로"}
          </Link>
        )}
      {confirm && !readOnly && (
        <Dialog
          title={
            confirm === "complete"
              ? "운동을 완료했나요?"
              : confirm === "end"
                ? "운동을 여기서 종료할까요?"
                : "서버에 저장된 상태로 돌아갈까요?"
          }
          onClose={closeConfirmation}
          busy={state.saving}
        >
          <div className="stack">
            <p className="muted">
              {workout.routine && confirm !== "reset"
                ? "시청량이 80% 미만이에요. 종료하면 이 영상은 미완료로 남고 다음 영상으로 이동해요. 미완료 영상은 운동 목록에서 다시 시작할 수 있어요."
                : confirm === "complete"
                  ? "직접 운동을 마쳤는지 확인해 주세요. 완료 후에는 진행 기록을 변경할 수 없어요."
                  : confirm === "end"
                    ? "시청량이 절반 미만이면 미진행, 절반 이상이면 중단으로 기록돼요. 나중에 이어갈 수 있어요."
                    : "서버가 거절한 미저장 진행은 버리고, 서버에 저장된 위치와 상태를 불러와요."}
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={state.saving}
                onClick={closeConfirmation}
              >
                취소
              </button>
              <button
                className="button primary"
                disabled={
                  state.saving ||
                  (confirm !== "reset" &&
                    (state.pending > 0 || state.error !== undefined))
                }
                onClick={() => {
                  if (confirm === "reset") {
                    restored.current = false;
                    void session.refresh(true).then(() => {
                      if (video.current)
                        video.current.currentTime =
                          session.getSnapshot().workout.progress.positionSeconds;
                    });
                    setConfirm(null);
                  } else void finalize(confirm);
                }}
              >
                {confirm === "complete"
                  ? "완료 확인"
                  : confirm === "end"
                    ? "종료 확인"
                    : "저장된 상태 불러오기"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

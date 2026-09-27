"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/http";
import { createPlaybackSession, samplePlayback } from "@/lib/playback-session";
import { workoutJournal } from "@/lib/workout-journal";
import { getWorkout, sendWorkoutEvent } from "@/lib/workouts";
import type { Workout } from "@/lib/workout-types";
import { useSession } from "./session-provider";
import { Dialog, Notice } from "./ui";
import { useUnsaved } from "./use-unsaved";
import { WorkoutError } from "./workout-error";
import { useWorkoutHistory } from "./workout-history-provider";
import { WorkoutSummary } from "./workout-summary";

export function WorkoutPlayer({ initial }: { initial: Workout }) {
  const userId = useSession().user!.id;
  const [session] = useState(() =>
    createPlaybackSession({
      initial,
      acquire: () => workoutJournal.acquire(userId, initial.id),
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
  const video = useRef<HTMLVideoElement>(null);
  const restored = useRef(false);
  const lastSave = useRef(0);
  const suppressPause = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [ended, setEnded] = useState(false);
  const [confirm, setConfirm] = useState<"end" | "complete" | "reset" | null>(
    null,
  );
  const canPlay =
    state.connected &&
    !state.recovering &&
    (workout.status === "in_progress" || workout.status === "completed") &&
    state.error === undefined &&
    !state.terminalPending;
  const verified =
    workout.video.playbackStatus === "verified" && !!workout.video.playbackUrl;
  const completed = workout.status === "completed";
  const { reload: reloadHistory } = useWorkoutHistory();
  useEffect(() => {
    if (completed) reloadHistory();
  }, [completed, reloadHistory]);
  useUnsaved(
    (playing && !completed) || state.pending > 0,
    "운동 진행을 저장하고 있어요. 이 화면을 나가면 재생을 멈추고, 미확정 저장은 돌아온 뒤 다시 확인해요. 나갈까요?",
  );
  useEffect(() => {
    session.connect();
    const mountedMedia = video.current;
    const capturePause = () => {
      const media = video.current ?? mountedMedia;
      if (!media) return;
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
  // The current-assignment card can receive a newer revision on focus or manual refresh.
  useEffect(() => {
    if (initial.revision > session.getSnapshot().workout.revision)
      void session.refresh();
  }, [initial, session]);
  useEffect(() => {
    if (!canPlay) video.current?.pause();
  }, [canPlay]);
  useEffect(() => {
    if (completed) {
      video.current?.pause();
      if (video.current) video.current.currentTime = 0;
    }
  }, [completed]);
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
    if (media && session.getSnapshot().workout.status === "in_progress")
      void session.record(
        type,
        samplePlayback(media, session.getSnapshot().workout),
      );
  }
  async function start() {
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
    setEnded(false);
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
  function finalize(type: "end" | "complete") {
    const media = video.current;
    suppressPause.current = true;
    media?.pause();
    const sample = media
      ? samplePlayback(media, workout)
      : { positionSeconds: workout.progress.positionSeconds, intervals: [] };
    void session.record(type, sample);
    suppressPause.current = false;
    setConfirm(null);
  }
  const rejected =
    state.error instanceof ApiError &&
    [400, 409, 404].includes(state.error.status);
  return (
    <div className="stack">
      <WorkoutSummary workout={workout} />
      {completed && (
        <Notice tone="success">
          운동을 완료했어요. 영상을 다시 볼 수 있고, 완료한 운동의 기록은
          변경되지 않아요.
        </Notice>
      )}
      {state.error !== undefined && <WorkoutError error={state.error} />}
      {state.pending > 0 && (
        <Notice tone="info">
          {state.saving
            ? "운동 진행을 저장하고 있어요."
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
        <Notice tone="info">
          {workout.video.playbackStatus === "duration_mismatch"
            ? "영상 길이를 확인하지 못해 재생할 수 없어요."
            : "현재 이 영상을 재생할 수 없어요."}{" "}
          잠시 후 다시 확인해 주세요.
        </Notice>
      ) : (
        <>
          <video
            ref={video}
            className="workout-video"
            src={workout.video.playbackUrl!}
            controls={canPlay}
            playsInline
            preload="metadata"
            aria-label="운동 영상"
            onLoadedMetadata={(event) => {
              if (restored.current || session.getSnapshot().recovering) return;
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
            onPlay={() => {
              const latest = session.getSnapshot();
              if (
                !latest.connected ||
                latest.recovering ||
                !["in_progress", "completed"].includes(latest.workout.status) ||
                latest.error !== undefined ||
                latest.terminalPending
              ) {
                video.current?.pause();
                return;
              }
              setPlaying(true);
              setEnded(false);
              lastSave.current = performance.now();
            }}
            onPause={() => {
              setPlaying(false);
              if (!suppressPause.current) capture("pause");
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
              setEnded(true);
              capture("pause");
            }}
            onError={() => {
              setMediaError(
                "영상을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.",
              );
              video.current?.pause();
            }}
          />
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
          {ended && !completed && (
            <Notice tone="info">
              영상이 끝났어요. 운동을 마쳤다면 아래에서 완료를 확인해 주세요.
            </Notice>
          )}
          {!completed && workout.status !== "in_progress" && (
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
              {workout.status === "assigned" ? "운동 시작" : "이어서 운동하기"}
            </button>
          )}
          {!completed && workout.status === "in_progress" && (
            <>
              <p className="caption">
                영상의 재생·일시정지 버튼으로 이어갈 수 있어요. 건너뛴 구간은
                시청량에 포함되지 않아요.
              </p>
              <div className="button-row">
                <button
                  className="button secondary"
                  disabled={
                    state.saving ||
                    state.pending > 0 ||
                    state.error !== undefined
                  }
                  onClick={() => {
                    video.current?.pause();
                    setConfirm("end");
                  }}
                >
                  여기서 종료
                </button>
                <button
                  className="button primary"
                  disabled={
                    state.saving ||
                    state.pending > 0 ||
                    state.error !== undefined
                  }
                  onClick={() => {
                    video.current?.pause();
                    setConfirm("complete");
                  }}
                >
                  운동 완료
                </button>
              </div>
            </>
          )}
        </>
      )}
      <button
        className="text-button"
        disabled={state.saving || playing}
        onClick={() => void session.refresh()}
      >
        저장된 운동 상태 확인
      </button>
      {confirm && (
        <Dialog
          title={
            confirm === "complete"
              ? "운동을 완료했나요?"
              : confirm === "end"
                ? "운동을 여기서 종료할까요?"
                : "서버에 저장된 상태로 돌아갈까요?"
          }
          onClose={() => setConfirm(null)}
          busy={state.saving}
        >
          <div className="stack">
            <p className="muted">
              {confirm === "complete"
                ? "직접 운동을 마쳤는지 확인해 주세요. 완료 후에는 진행 기록을 변경할 수 없어요."
                : confirm === "end"
                  ? "시청량이 절반 미만이면 미진행, 절반 이상이면 중단으로 기록돼요. 나중에 이어갈 수 있어요."
                  : "서버가 거절한 미저장 진행은 버리고, 서버에 저장된 위치와 상태를 불러와요."}
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={state.saving}
                onClick={() => setConfirm(null)}
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
                  } else finalize(confirm);
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

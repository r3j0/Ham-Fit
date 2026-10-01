import type {
  PlaybackEvent,
  PlaybackInterval,
  Workout,
} from "./workout-types.ts";
import type { WorkoutWriter } from "./workout-journal.ts";
import { ApiError } from "./http.ts";
import { canRecordWorkout, mergeWorkoutSnapshot } from "./workout-recording.ts";

export interface PlaybackSample {
  positionSeconds: number;
  intervals: PlaybackInterval[];
}
/** Use the browser's played ranges, never a seek target or wall-clock time. */
export function samplePlayback(
  media: Pick<HTMLVideoElement, "currentTime" | "played">,
  workout: Workout,
): PlaybackSample {
  const limit =
    workout.video.playbackStatus === "verified"
      ? Math.max(
          workout.video.durationSeconds,
          workout.video.verifiedDurationSeconds ?? 0,
        )
      : workout.video.durationSeconds;
  const positionSeconds = Number.isFinite(media.currentTime)
    ? Math.min(limit, Math.max(0, media.currentTime))
    : 0;
  const intervals: PlaybackInterval[] = [];
  for (let i = 0; i < media.played.length; i++) {
    const start = Math.max(0, media.played.start(i));
    const end = Math.min(limit, media.played.end(i));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start)
      intervals.push({ start, end });
  }
  return { positionSeconds, intervals };
}
/** Decide whether a stop needs confirmation; only the server finalizes completion. */
export function hasWatchedEnough(workout: Workout, sample: PlaybackSample) {
  const duration = workout.progress.durationSeconds;
  const intervals = [...workout.progress.intervals, ...sample.intervals]
    .map(({ start, end }) => ({ start, end: Math.min(end, duration) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);
  let watched = 0,
    end = 0,
    correction = 0;
  for (const interval of intervals) {
    const length =
      Math.max(0, interval.end - Math.max(end, interval.start)) - correction;
    const next = watched + length;
    correction = next - watched - length;
    watched = next;
    end = Math.max(end, interval.end);
  }
  const threshold = duration * 0.8;
  return (
    watched >= threshold - 8 * Number.EPSILON * Math.max(watched, threshold)
  );
}
interface PlaybackSnapshot {
  workout: Workout;
  pending: number;
  saving: boolean;
  error: unknown;
  connected: boolean;
  terminalPending: boolean;
  recovering: boolean;
  recordingAllowed: boolean;
}
export function createPlaybackSession(options: {
  initial: Workout;
  acquire: () => WorkoutWriter;
  send: (key: string, body: string) => Promise<Workout>;
  fetch: () => Promise<Workout>;
  uuid?: () => string;
  now?: () => number;
}) {
  let state: PlaybackSnapshot = {
    workout: options.initial,
    pending: 0,
    saving: false,
    error: undefined,
    connected: false,
    terminalPending: false,
    recovering: true,
    recordingAllowed: canRecordWorkout(
      options.initial,
      (options.now ?? (() => performance.now()))(),
    ),
  };
  const listeners = new Set<() => void>();
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => performance.now());
  let expired = !!(
    options.initial.routine &&
    (options.initial.koreanDate < options.initial.serverKoreanDate ||
      (options.initial.recording?.allowed &&
        !canRecordWorkout(options.initial, now())))
  );
  let writer: WorkoutWriter | undefined;
  let deviceId = "";
  let sequence = 0;
  let running: Promise<void> | undefined;
  let reading = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let expirationRead: Promise<void> | undefined;
  function publish(patch: Partial<PlaybackSnapshot>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  function queueState() {
    const requests = writer?.read() ?? [];
    return {
      pending: requests.length,
      terminalPending: requests.some((r) => {
        try {
          return (
            state.workout.routine
              ? ["pause", "end", "complete"]
              : ["end", "complete"]
          ).includes(JSON.parse(r.body).type);
        } catch {
          return false;
        }
      }),
    };
  }
  const current = (lease: WorkoutWriter) => writer === lease && lease.active();
  function stopRecording(confirmPending = false) {
    if (!state.workout.routine) return;
    const lease = writer;
    const hadPending = !!lease?.read().length;
    writer?.save([]);
    publish({
      recordingAllowed: false,
      recovering: false,
      error: undefined,
      ...queueState(),
    });
    if (confirmPending && hadPending && lease && current(lease) && !reading) {
      reading = true;
      expirationRead = options
        .fetch()
        .then((saved) => {
          if (current(lease)) updateWorkout(saved);
        })
        .catch(() => {
          /* Viewing remains available when the final confirmation read fails. */
        })
        .finally(() => {
          if (current(lease)) {
            reading = false;
            expirationRead = undefined;
          }
        });
    }
  }
  function recordingAllowed() {
    if (
      state.workout.recording?.allowed &&
      now() >= state.workout.recording.deadline
    )
      expired = true;
    if (
      expired ||
      !state.recordingAllowed ||
      !canRecordWorkout(state.workout, now())
    ) {
      if (state.workout.routine) stopRecording(true);
      return false;
    }
    return true;
  }
  function updateWorkout(saved: Workout) {
    const workout = mergeWorkoutSnapshot(state.workout, saved);
    if (workout.routine && workout.koreanDate < workout.serverKoreanDate)
      expired = true;
    publish({
      workout,
      recordingAllowed: !expired && canRecordWorkout(workout, now()),
    });
    if (!state.recordingAllowed) stopRecording();
    scheduleExpiry();
  }
  function scheduleExpiry() {
    clearTimeout(expiry);
    if (
      !writer?.active() ||
      !state.workout.recording ||
      !state.recordingAllowed
    )
      return;
    expiry = setTimeout(
      () => {
        recordingAllowed();
      },
      Math.min(
        2147483647,
        Math.max(0, Math.ceil(state.workout.recording.deadline - now())),
      ),
    );
  }
  async function drain() {
    if (running) return running;
    const lease = writer;
    if (
      !lease ||
      !current(lease) ||
      reading ||
      state.error !== undefined ||
      !recordingAllowed()
    )
      return;
    const run = async () => {
      if (!current(lease)) return;
      publish({ saving: true });
      try {
        while (current(lease)) {
          if (!recordingAllowed()) break;
          const request = lease.read()[0];
          if (!request) break;
          const saved = await options.send(request.key, request.body);
          if (!current(lease)) return;
          updateWorkout(saved);
          if (!recordingAllowed()) break;
          // Only acknowledge the request actually sent, never a successor's queue.
          const queue = lease.read();
          if (queue[0]?.key !== request.key) return;
          lease.save(saved.status === "completed" ? [] : queue.slice(1));
          publish({
            ...queueState(),
          });
        }
      } catch (error) {
        if (current(lease)) {
          if (error instanceof ApiError && error.code === "ROUTINE_EXPIRED") {
            expired = true;
            const recording = state.workout.recording;
            publish({
              workout: {
                ...state.workout,
                recording: recording
                  ? { ...recording, allowed: false }
                  : recording,
              },
            });
            stopRecording();
            try {
              const saved = await options.fetch();
              if (current(lease)) updateWorkout(saved);
            } catch {
              /* Expiration must never block video viewing on a failed confirmation read. */
            }
          } else if (recordingAllowed()) publish({ error });
        }
      } finally {
        if (current(lease)) {
          running = undefined;
          publish({
            saving: false,
            recovering: lease.read().length > 0 && state.recovering,
            ...queueState(),
          });
        }
      }
    };
    // Defer invocation so even an empty queue cannot leave a settled running promise.
    running = Promise.resolve().then(run);
    return running;
  }
  return {
    getSnapshot: () => state,
    canRecord: recordingAllowed,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect() {
      writer = options.acquire();
      deviceId = uuid();
      sequence = 0;
      running = undefined;
      reading = false;
      if (
        state.workout.status === "completed" ||
        !canRecordWorkout(state.workout, now())
      )
        writer.save([]);
      publish({
        connected: true,
        saving: false,
        error: undefined,
        recovering: writer.read().length > 0,
        ...queueState(),
      });
      scheduleExpiry();
      void drain();
    },
    disconnect() {
      clearTimeout(expiry);
      writer?.release();
      writer = undefined;
      running = undefined;
    },
    record(type: PlaybackEvent["type"], sample: PlaybackSample) {
      if (
        !writer?.active() ||
        !recordingAllowed() ||
        reading ||
        state.workout.status === "completed" ||
        state.terminalPending
      )
        return;
      const queue = writer.read();
      const starting = queue.some((r) => {
        try {
          return JSON.parse(r.body).type === "start";
        } catch {
          return false;
        }
      });
      if (
        type !== "start" &&
        state.workout.status !== "in_progress" &&
        !(
          state.workout.routine &&
          ["pause", "end", "complete"].includes(type) &&
          ["interrupted", "not_performed"].includes(state.workout.status)
        ) &&
        !starting
      )
        return;
      // A new player instance uses a new stream ID. Persisted events retain their original stream and sequence.
      const intervals = sample.intervals;
      const chunks = Math.max(1, Math.ceil(intervals.length / 1000));
      for (let i = 0; i < chunks; i++) {
        const event: PlaybackEvent = {
          type: i === chunks - 1 ? type : "progress",
          deviceId,
          sequence: ++sequence,
          positionSeconds: sample.positionSeconds,
          intervals: intervals.slice(i * 1000, (i + 1) * 1000),
        };
        queue.push({ key: uuid(), body: JSON.stringify(event) });
      }
      writer.save(queue);
      publish(queueState());
      return drain();
    },
    retry() {
      if (!recordingAllowed()) return expirationRead;
      if (reading) return;
      publish({ error: undefined });
      return drain();
    },
    async refresh(discardRejected = false) {
      const lease = writer;
      if (!lease || !current(lease) || state.saving || reading) return;
      // Unknown outcomes must be replayed, never discarded by a read or reset.
      const rejected =
        state.error instanceof ApiError &&
        [400, 409, 404].includes(state.error.status);
      if (discardRejected && !rejected) return;
      reading = true;
      publish({ saving: true });
      try {
        const saved = await options.fetch();
        if (!current(lease)) return;
        updateWorkout(saved);
        if (
          discardRejected ||
          saved.status === "completed" ||
          !state.recordingAllowed
        )
          lease.save([]);
        publish({
          error:
            discardRejected ||
            saved.status === "completed" ||
            !state.recordingAllowed
              ? undefined
              : state.error,
          recovering: lease.read().length > 0 && state.recovering,
          ...queueState(),
        });
      } catch (error) {
        if (current(lease)) publish({ error });
      } finally {
        if (current(lease)) {
          reading = false;
          publish({ saving: false });
        }
      }
    },
  };
}

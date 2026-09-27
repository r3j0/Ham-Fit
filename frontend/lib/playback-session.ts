import type {
  PlaybackEvent,
  PlaybackInterval,
  Workout,
} from "./workout-types.ts";
import type { WorkoutWriter } from "./workout-journal.ts";
import { ApiError } from "./http.ts";

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
interface PlaybackSnapshot {
  workout: Workout;
  pending: number;
  saving: boolean;
  error: unknown;
  connected: boolean;
  terminalPending: boolean;
  recovering: boolean;
}
export function createPlaybackSession(options: {
  initial: Workout;
  acquire: () => WorkoutWriter;
  send: (key: string, body: string) => Promise<Workout>;
  fetch: () => Promise<Workout>;
  uuid?: () => string;
}) {
  let state: PlaybackSnapshot = {
    workout: options.initial,
    pending: 0,
    saving: false,
    error: undefined,
    connected: false,
    terminalPending: false,
    recovering: true,
  };
  const listeners = new Set<() => void>();
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  let writer: WorkoutWriter | undefined;
  let deviceId = "";
  let sequence = 0;
  let running: Promise<void> | undefined;
  let reading = false;
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
          return ["end", "complete"].includes(JSON.parse(r.body).type);
        } catch {
          return false;
        }
      }),
    };
  }
  const current = (lease: WorkoutWriter) => writer === lease && lease.active();
  async function drain() {
    if (running) return running;
    const lease = writer;
    if (!lease || !current(lease) || reading || state.error !== undefined)
      return;
    const run = async () => {
      if (!current(lease)) return;
      publish({ saving: true });
      try {
        while (current(lease)) {
          const request = lease.read()[0];
          if (!request) break;
          const saved = await options.send(request.key, request.body);
          if (!current(lease)) return;
          // Only acknowledge the request actually sent, never a successor's queue.
          const queue = lease.read();
          if (queue[0]?.key !== request.key) return;
          lease.save(saved.status === "completed" ? [] : queue.slice(1));
          publish({
            workout:
              saved.revision >= state.workout.revision ? saved : state.workout,
            ...queueState(),
          });
        }
      } catch (error) {
        if (current(lease)) publish({ error });
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
      if (state.workout.status === "completed") writer.save([]);
      publish({
        connected: true,
        saving: false,
        error: undefined,
        recovering: writer.read().length > 0,
        ...queueState(),
      });
      void drain();
    },
    disconnect() {
      writer?.release();
      writer = undefined;
      running = undefined;
    },
    record(type: PlaybackEvent["type"], sample: PlaybackSample) {
      if (
        !writer?.active() ||
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
        if (discardRejected || saved.status === "completed") lease.save([]);
        publish({
          workout:
            saved.revision >= state.workout.revision ? saved : state.workout,
          error:
            discardRejected || saved.status === "completed"
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

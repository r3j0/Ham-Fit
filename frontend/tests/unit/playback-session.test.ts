import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../../lib/http.ts";
import {
  createPlaybackSession,
  samplePlayback,
} from "../../lib/playback-session.ts";
import { createWorkoutJournal } from "../../lib/workout-journal.ts";
import type { Workout } from "../../lib/workout-types.ts";

const initial: Workout = {
  id: "workout",
  koreanDate: "2026-09-27",
  serverKoreanDate: "2026-09-27",
  status: "assigned",
  resultStatus: null,
  revision: 1,
  assignedAt: "2026-09-27T00:00:00Z",
  performedAt: null,
  completedAt: null,
  video: {
    id: "video",
    title: "test",
    durationSeconds: 100,
    equipment: [],
    ageGroup: "adult",
    catalogVersion: "test",
    fitnessWeights: {},
    originalUrl: "http://example.test/video.mp4",
    playbackUrl: "https://example.test/video.mp4",
    playbackStatus: "verified",
    verifiedDurationSeconds: 100.4,
  },
  progress: {
    durationSeconds: 100,
    watchedSeconds: 0,
    positionSeconds: 0,
    intervals: [],
    ratio: 0,
  },
  algorithmVersion: "test",
  inputSnapshot: null,
  weightAdjustment: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const empty = { positionSeconds: 0, intervals: [] };
test("native played ranges exclude seeks and preserve verified fractional endpoints", () => {
  const sample = samplePlayback(
    {
      currentTime: 100.4,
      played: {
        length: 2,
        start: (i) => [0, 90][i],
        end: (i) => [5, 100.4][i],
      },
    },
    initial,
  );
  assert.deepEqual(sample, {
    positionSeconds: 100.4,
    intervals: [
      { start: 0, end: 5 },
      { start: 90, end: 100.4 },
    ],
  });
  const unavailable = {
    ...initial,
    video: { ...initial.video, playbackStatus: "unavailable" as const },
  };
  assert.equal(
    samplePlayback(
      {
        currentTime: 110,
        played: { length: 1, start: () => 99, end: () => 110 },
      },
      unavailable,
    ).intervals[0].end,
    100,
  );
});
test("serializes start before progress and preserves exact requests on response loss", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  const first = deferred<Workout>();
  const sent: { key: string; body: string }[] = [];
  let lose = true;
  const session = createPlaybackSession({
    initial,
    acquire: () => journal.acquire("user", initial.id),
    fetch: async () => initial,
    send: async (key, body) => {
      sent.push({ key, body });
      if (sent.length === 1) return first.promise;
      if (lose) throw new ApiError(0, "lost");
      return { ...initial, status: "in_progress", revision: 3 };
    },
  });
  session.connect();
  const pending = session.record("start", empty);
  session.record("progress", {
    positionSeconds: 12.5,
    intervals: [{ start: 0, end: 12.5 }],
  });
  await Promise.resolve();
  assert.equal(sent.length, 1);
  first.resolve({ ...initial, status: "in_progress", revision: 2 });
  await pending;
  assert.equal(session.getSnapshot().pending, 1);
  assert.ok(session.getSnapshot().error);
  lose = false;
  await session.retry();
  assert.deepEqual(sent[1], sent[2]);
  assert.equal(JSON.parse(sent[0].body).sequence, 1);
  assert.equal(JSON.parse(sent[1].body).sequence, 2);
  assert.equal(session.getSnapshot().pending, 0);
});
test("reentry replays the old request but gives new events a distinct stream; old replies cannot acknowledge it", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  const delayed = deferred<Workout>();
  const sent: string[] = [];
  const options = {
    initial,
    acquire: () => journal.acquire("user", initial.id),
    fetch: async () => initial,
  };
  const old = createPlaybackSession({
    ...options,
    send: async (_key, body) => {
      sent.push(body);
      return delayed.promise;
    },
  });
  old.connect();
  const pending = old.record("start", empty);
  await Promise.resolve();
  old.disconnect();
  const newer = createPlaybackSession({
    ...options,
    send: async (_key, body) => {
      sent.push(body);
      return { ...initial, status: "in_progress", revision: 2 };
    },
  });
  newer.connect();
  await newer.retry();
  assert.equal(sent[0], sent[1]);
  await newer.record("progress", empty);
  assert.notEqual(JSON.parse(sent[1]).deviceId, JSON.parse(sent[2]).deviceId);
  delayed.resolve({ ...initial, status: "in_progress", revision: 2 });
  await pending;
  assert.equal(newer.getSnapshot().pending, 0);
  assert.equal(old.getSnapshot().workout.status, "assigned");
});
test("a final event suppresses trailing pause/progress, and completed replies stop the queue", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  const sent: string[] = [];
  const session = createPlaybackSession({
    initial: { ...initial, status: "in_progress" },
    acquire: () => journal.acquire("user", initial.id),
    fetch: async () => initial,
    send: async (_key, body) => {
      sent.push(body);
      return { ...initial, status: "completed", revision: 2 };
    },
  });
  session.connect();
  const pending = session.record("complete", empty);
  session.record("pause", empty);
  await pending;
  session.record("start", empty);
  assert.equal(sent.length, 1);
  assert.equal(session.getSnapshot().workout.status, "completed");
});
test("unknown failures cannot be discarded by refresh and logout prevents late writes", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  const session = createPlaybackSession({
    initial,
    acquire: () => journal.acquire("user", initial.id),
    fetch: async () => initial,
    send: async () => {
      throw new ApiError(0, "lost");
    },
  });
  session.connect();
  await session.record("start", empty);
  await session.refresh(true);
  assert.equal(session.getSnapshot().pending, 1);
  journal.clear();
  session.record("progress", empty);
  journal.setOwner("user");
  assert.deepEqual(journal.acquire("user", initial.id).read(), []);
});
test("chunks played ranges within the server limit without inventing a completion", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  const events: { type: string; intervals: unknown[] }[] = [];
  const session = createPlaybackSession({
    initial: { ...initial, status: "in_progress" },
    acquire: () => journal.acquire("user", initial.id),
    fetch: async () => initial,
    send: async (_key, body) => {
      events.push(JSON.parse(body));
      return { ...initial, status: "in_progress", revision: 2 };
    },
  });
  session.connect();
  await session.record("pause", {
    positionSeconds: 99,
    intervals: Array.from({ length: 1001 }, (_, i) => ({
      start: i / 20,
      end: i / 20 + 0.01,
    })),
  });
  assert.deepEqual(
    events.map((e) => [e.type, e.intervals.length]),
    [
      ["progress", 1000],
      ["pause", 1],
    ],
  );
});

const routineWorkout = (): Workout => ({
  ...initial,
  koreanDate: "2026-09-29",
  serverKoreanDate: "2026-09-29",
  routine: {
    id: "routine",
    itemId: "item",
    order: 1,
    totalItems: 1,
    prescription: {
      doseType: "reps",
      value: "10",
      unit: "회",
      sets: 3,
      restSec: 30,
      text: "10회 × 3세트",
    },
  },
  recording: {
    allowed: true,
    serverTime: "2026-09-29T14:59:59Z",
    expiresAt: "2026-09-29T15:00:00Z",
    deadline: 1000,
  },
});

test("expired routines discard recovery and never enqueue any event type", async () => {
  for (const status of [
    "assigned",
    "in_progress",
    "not_performed",
    "interrupted",
    "completed",
  ] as const) {
    const journal = createWorkoutJournal(() => undefined);
    journal.setOwner("user");
    const old = journal.acquire("user", initial.id);
    old.save([
      { key: crypto.randomUUID(), body: JSON.stringify({ type: "start" }) },
    ]);
    old.release();
    let sent = 0;
    const workout = {
      ...routineWorkout(),
      status,
      recording: { ...routineWorkout().recording!, allowed: false },
    };
    const session = createPlaybackSession({
      initial: workout,
      now: () => 0,
      acquire: () => journal.acquire("user", initial.id),
      fetch: async () => workout,
      send: async () => {
        sent++;
        return workout;
      },
    });
    session.connect();
    for (const type of [
      "start",
      "progress",
      "pause",
      "end",
      "complete",
    ] as const)
      await session.record(type, empty);
    await session.retry();
    assert.equal(sent, 0);
    assert.equal(session.getSnapshot().pending, 0);
    assert.equal(session.getSnapshot().recordingAllowed, false);
    session.disconnect();
  }
});

test("monotonic expiry stops retries of an unknown result and background reads update equal revisions", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  let now = 0,
    sent = 0;
  const initial = routineWorkout();
  let server = initial;
  const session = createPlaybackSession({
    initial,
    now: () => now,
    acquire: () => journal.acquire("user", initial.id),
    fetch: async () => server,
    send: async () => {
      sent++;
      throw new ApiError(0, "lost");
    },
  });
  session.connect();
  await session.record("start", empty);
  assert.equal(session.getSnapshot().pending, 1);
  now = 1000;
  await session.retry();
  assert.equal(sent, 1);
  assert.equal(session.getSnapshot().pending, 0);
  server = {
    ...initial,
    serverKoreanDate: "2026-09-30",
    recording: {
      ...initial.recording!,
      allowed: false,
      serverTime: "2026-09-29T15:00:00Z",
    },
  };
  await session.refresh();
  assert.equal(session.getSnapshot().workout.serverKoreanDate, "2026-09-30");
  assert.equal(session.getSnapshot().recordingAllowed, false);
  session.disconnect();
});

test("server expiry stops queued successors and confirms saved state with GET", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  const workout = { ...routineWorkout(), status: "in_progress" as const };
  let sends = 0,
    reads = 0;
  const session = createPlaybackSession({
    initial: workout,
    now: () => 0,
    acquire: () => journal.acquire("user", initial.id),
    send: async () => {
      sends++;
      throw new ApiError(409, "expired", {}, undefined, "ROUTINE_EXPIRED");
    },
    fetch: async () => {
      reads++;
      return {
        ...workout,
        recording: {
          ...workout.recording!,
          allowed: false,
          serverTime: "2026-09-29T15:00:00Z",
        },
        serverKoreanDate: "2026-09-30",
      };
    },
  });
  session.connect();
  const pending = session.record("progress", empty);
  session.record("pause", empty);
  await pending;
  await session.retry();
  assert.equal(sends, 1);
  assert.equal(reads, 1);
  assert.equal(session.getSnapshot().pending, 0);
  assert.equal(session.getSnapshot().recordingAllowed, false);
  assert.equal(session.getSnapshot().error, undefined);
  session.disconnect();
});

test("v2 pause finalization blocks trailing events until an explicit start after interruption", async () => {
  const journal = createWorkoutJournal(() => undefined);
  journal.setOwner("user");
  const stopped = deferred<Workout>();
  const workout = { ...routineWorkout(), status: "in_progress" as const };
  const types: string[] = [];
  const session = createPlaybackSession({
    initial: workout,
    now: () => 0,
    acquire: () => journal.acquire("user", initial.id),
    fetch: async () => workout,
    send: async (_key, body) => {
      types.push(JSON.parse(body).type);
      return types.length === 1 ? stopped.promise : { ...workout, revision: 3 };
    },
  });
  session.connect();
  const pending = session.record("pause", empty);
  session.record("progress", empty);
  session.record("complete", empty);
  session.record("start", empty);
  await Promise.resolve();
  assert.deepEqual(types, ["pause"]);
  stopped.resolve({ ...workout, status: "interrupted", revision: 2 });
  await pending;
  await session.record("start", empty);
  assert.deepEqual(types, ["pause", "start"]);
  session.disconnect();
});

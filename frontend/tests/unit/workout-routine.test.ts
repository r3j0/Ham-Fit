import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceRoutine,
  initialRoutine,
  previewRoutine,
  type RoutineState,
  type RoutineAction,
  type WorkoutRoutine,
} from "../../lib/workout-routine.ts";
const routine = previewRoutine;
function act(state: RoutineState, type: RoutineAction["type"], now = 0) {
  return advanceRoutine(routine, state, { type, now });
}
function active(now = 0) {
  return act(act(initialRoutine(routine), "start", now), "tick", now + 3000);
}
test("preview reps require explicit completion; elapsed time cannot invent completed sets", () => {
  let state = act(initialRoutine(routine), "start");
  assert.equal(act(state, "finish-set", 2999), state);
  state = act(state, "tick", 123000);
  assert.equal(state.phase, "active");
  assert.equal(state.elapsedMs, 120000);
  assert.deepEqual(state.completedSets, [0, 0]);
  assert.equal(act(state, "skip-exercise"), state);
});
test("four confirmed sets complete both exercises; duplicate completion and rest skip are safe", () => {
  let state = initialRoutine(routine);
  let now = 0;
  for (let set = 0; set < 4; set++) {
    state = act(state, "start", now);
    state = act(state, "tick", (now += 3000));
    state = act(state, "finish-set", (now += 20000));
    assert.equal(act(state, "finish-set", now), state);
    if (set < 3) {
      assert.equal(state.phase, "rest");
      state = act(state, "skip-rest", now);
      assert.equal(state.phase, "ready");
    }
  }
  assert.equal(state.phase, "complete");
  assert.deepEqual(state.completedSets, [2, 2]);
  assert.deepEqual(state.skipped, []);
  assert.equal(state.exerciseMs, 80000);
  assert.equal(act(state, "start", now), state);
});
test("pausing or hiding freezes exercise and countdown time without counting the background interval", () => {
  let state = act(active(), "interrupt", 7000);
  assert.equal(state.phase, "paused");
  assert.equal(state.elapsedMs, 4000);
  assert.equal(act(state, "tick", 600000), state);
  state = act(state, "resume", 600000);
  state = act(state, "finish-set", 601000);
  assert.equal(state.exerciseMs, 5000);
  state = act(act(initialRoutine(routine), "start"), "interrupt", 1000);
  assert.equal(state.pausedPhase, "countdown");
  state = act(act(state, "resume", 10000), "tick", 12000);
  assert.equal(state.phase, "active");
  assert.equal(state.elapsedMs, 0);
});
test("rest freezes on pause and never starts another exercise automatically", () => {
  let state = act(active(), "finish-set", 8000);
  state = act(state, "interrupt", 18000);
  assert.equal(state.remainingMs, 20000);
  state = act(act(state, "resume", 100000), "tick", 120000);
  assert.equal(state.phase, "ready");
  assert.equal(state.index, 0);
  assert.deepEqual(state.completedSets, [1, 0]);
});
test("skips and early ending preserve only confirmed sets, including a partial exercise", () => {
  let state = act(active(), "finish-set", 8000);
  state = act(act(state, "skip-rest"), "skip-exercise");
  assert.equal(state.index, 1);
  state = act(state, "end");
  assert.deepEqual(state.completedSets, [1, 0]);
  assert.deepEqual(state.skipped, ["squat", "push-up"]);
  assert.equal(state.phase, "complete");
  assert.equal(state.exerciseMs, 5000);
});
test("the same routine engine accepts timed targets without measurement inputs", () => {
  const timed: WorkoutRoutine = {
    ...routine,
    exercises: [
      {
        ...routine.exercises[0],
        sets: 1,
        target: { kind: "time", seconds: 20 },
      },
    ],
  };
  let state = advanceRoutine(timed, initialRoutine(timed), {
    type: "start",
    now: 0,
  });
  state = advanceRoutine(timed, state, { type: "tick", now: 22999 });
  assert.equal(state.phase, "active");
  assert.equal(
    advanceRoutine(timed, state, { type: "finish-set", now: 22999 }),
    state,
  );
  state = advanceRoutine(timed, state, { type: "tick", now: 23000 });
  assert.equal(state.phase, "complete");
  assert.deepEqual(state.completedSets, [1]);
  assert.equal(state.exerciseMs, 20000);
});

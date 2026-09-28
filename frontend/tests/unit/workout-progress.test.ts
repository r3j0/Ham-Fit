import test from "node:test";
import assert from "node:assert/strict";
import {
  initialWorkout,
  advanceWorkout,
  type WorkoutState,
} from "../../lib/workout.ts";
import { adultAssessment } from "../../lib/assessment.ts";
import type { WorkoutDraft } from "../../lib/workout-progress.ts";
const definition = adultAssessment();
const draft = (state: WorkoutState): WorkoutDraft => ({
  state,
  stage: "session",
  setup: {
    age: "25",
    sex: "",
    height: "",
    weight: "",
    waist: "",
    measuredOn: "2026-09-21",
  },
  pending: null,
});
import {
  readWorkoutProgress,
  saveWorkoutProgress,
  setWorkoutOwner,
} from "../../lib/workout-progress.ts";

test("workout progress validates expiry in memory and rejects writes from a previous account", () => {
  // No window/sessionStorage: exercise the supported memory fallback.
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    setWorkoutOwner("first", true);
    const active = advanceWorkout(definition, initialWorkout(), {
      type: "start",
      now,
    });
    now += 1500;
    saveWorkoutProgress("first", draft(active));
    const restored = readWorkoutProgress("first");
    assert.equal(restored?.state.remainingMs, 0);
    assert.equal(restored?.state.runningSince, null);
    setWorkoutOwner(null); // Session expiration preserves same-account progress.
    setWorkoutOwner("first");
    assert.equal(readWorkoutProgress("first")?.state.phase, "interrupted");
    now += 24 * 3600000 + 1;
    assert.equal(readWorkoutProgress("first"), null);
    saveWorkoutProgress("first", draft(active));
    setWorkoutOwner("second");
    saveWorkoutProgress("first", draft(active));
    assert.equal(readWorkoutProgress("second"), null);
    setWorkoutOwner("first");
    assert.equal(readWorkoutProgress("first"), null);
    saveWorkoutProgress("first", draft(initialWorkout()));
    setWorkoutOwner(null, true);
    assert.equal(readWorkoutProgress("first"), null);
  } finally {
    Date.now = originalNow;
    setWorkoutOwner(null, true);
  }
});

test("a failed storage write cannot replace newer progress with an old snapshot", () => {
  let raw: string | null = null;
  let blockWrites = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: () => raw,
        setItem: (_key: string, value: string) => {
          if (blockWrites) throw new Error("QuotaExceededError");
          raw = value;
        },
        removeItem: () => {
          raw = null;
        },
      },
    },
  });
  try {
    setWorkoutOwner("storage-test", true);
    saveWorkoutProgress("storage-test", draft(initialWorkout()));
    blockWrites = true;
    const active = advanceWorkout(definition, initialWorkout(), {
      type: "start",
      now: Date.now(),
    });
    saveWorkoutProgress("storage-test", draft(active));
    assert.equal(
      readWorkoutProgress("storage-test")?.state.phase,
      "interrupted",
    );
  } finally {
    setWorkoutOwner(null, true);
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("logout cannot resurrect progress when storage deletion fails", () => {
  let raw: string | null = null;
  let blockRemoval = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: () => raw,
        setItem: (_key: string, value: string) => {
          raw = value;
        },
        removeItem: () => {
          if (blockRemoval) throw new Error("SecurityError");
          raw = null;
        },
      },
    },
  });
  try {
    setWorkoutOwner("storage-test", true);
    saveWorkoutProgress("storage-test", draft(initialWorkout()));
    blockRemoval = true;
    setWorkoutOwner(null, true);
    setWorkoutOwner("storage-test");
    assert.equal(readWorkoutProgress("storage-test"), null);
  } finally {
    blockRemoval = false;
    setWorkoutOwner(null, true);
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("an unresolved save retains its exact idempotency key/body after ordinary expiry", () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    setWorkoutOwner("pending", true);
    const d = draft({
      ...initialWorkout(),
      phase: "review",
      skipped: ["endurance", "cardio", "flexibility"],
    });
    d.catalogVersion = "test";
    d.pending = {
      key: "12345678-1234-1234-1234-123456789012",
      body: JSON.stringify({
        // An old in-flight request must not be rewritten after a contract update.
        entryMethod: "self_assessment",
        reportKind: "simple",
        catalogVersion: "test",
        items: [{ measurementCode: "height", value: "170", unit: "cm" }],
      }),
    };
    saveWorkoutProgress("pending", d);
    now += 25 * 3600000;
    assert.deepEqual(readWorkoutProgress("pending")?.pending, d.pending);
  } finally {
    Date.now = originalNow;
    setWorkoutOwner(null, true);
  }
});

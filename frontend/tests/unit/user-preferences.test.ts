import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPreferencesPatch,
  parseExercisePreferences,
  exerciseVolumeOptions,
  exerciseGoalOptions,
  ownedToolOptions,
} from "../../lib/user-preferences.ts";
const initial = {
  exerciseVolume: "standard",
  exerciseGoal: null,
  ownedTools: [],
  updatedAt: "2026-09-26T00:00:00.000Z",
} as const;

test("preferences accept all API enum combinations, including an unselected goal", () => {
  for (const volume of exerciseVolumeOptions)
    for (const goal of [
      null,
      ...exerciseGoalOptions.map((option) => option.value),
    ]) {
      const value = {
        ...initial,
        exerciseVolume: volume.value,
        exerciseGoal: goal,
      };
      assert.deepEqual(parseExercisePreferences(value), value);
    }
});
test("missing, invalid and legacy preferences never become default settings", () => {
  for (const value of [
    null,
    {},
    [],
    { ...initial, exerciseVolume: "MORE" },
    { ...initial, exerciseGoal: undefined },
    { ...initial, exerciseGoal: "weight_loss" },
    { ...initial, updatedAt: undefined },
    { ...initial, updatedAt: "invalid" },
    ...[
      undefined,
      null,
      "band",
      {},
      ["none"],
      ["barbell"],
      ["foam_roller"],
      ["bosu"],
      ["agility_ladder"],
      ["cone"],
      ["band", null],
    ].map((ownedTools) => ({ ...initial, ownedTools })),
    { ...initial, updatedAt: "2026-09-26T00:00:00" },
  ])
    assert.throws(() => parseExercisePreferences(value), /운동 설정을 확인/);
});

test("tools are a canonical set, unchanged sets omit PATCH, and empty arrays clear", () => {
  const tools = ownedToolOptions.map((option) => option.value);
  const saved = { ...initial, ownedTools: tools };
  assert.deepEqual(
    parseExercisePreferences({
      ...saved,
      ownedTools: [...tools].reverse().concat("band"),
    }),
    saved,
  );
  assert.equal(
    buildPreferencesPatch(saved, {
      ...saved,
      ownedTools: [...tools].reverse(),
    }),
    null,
  );
  assert.deepEqual(buildPreferencesPatch(saved, initial), { ownedTools: [] });
  assert.deepEqual(buildPreferencesPatch(initial, saved), {
    ownedTools: tools,
  });
  assert.deepEqual(
    buildPreferencesPatch(saved, { ...saved, exerciseVolume: "more" }),
    { exerciseVolume: "more" },
  );
});
test("unchanged preferences do not produce an empty PATCH", () => {
  assert.equal(buildPreferencesPatch(initial, { ...initial }), null);
});
test("volume-only edits omit a null goal and server metadata", () => {
  assert.deepEqual(
    buildPreferencesPatch(initial, { ...initial, exerciseVolume: "less" }),
    { exerciseVolume: "less" },
  );
});
test("goal-only edits and combined edits contain only changed enum fields", () => {
  const draft = {
    ...initial,
    exerciseGoal: "general_fitness_improvement",
  } as const;
  assert.deepEqual(buildPreferencesPatch(initial, draft), {
    exerciseGoal: draft.exerciseGoal,
  });
  assert.deepEqual(
    buildPreferencesPatch(initial, { ...draft, exerciseVolume: "more" }),
    { exerciseVolume: "more", exerciseGoal: draft.exerciseGoal },
  );
  assert.equal(
    buildPreferencesPatch(draft, { ...draft, exerciseGoal: null }),
    null,
  );
});

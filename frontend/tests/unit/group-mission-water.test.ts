import assert from "node:assert/strict";
import test from "node:test";
import { parseMissionWater } from "../../lib/group-mission-water-contract.ts";
const id = (n: number) =>
  `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = {
  sourceKind: "routine",
  sourceId: id(1),
  koreanDate: "2026-10-02",
  reason: null,
};
const option = {
  groupId: id(2),
  groupName: "함께 운동",
  roundId: id(3),
  waterCount: 3,
  totalTarget: 28,
  stage: "sprout",
};
test("daily mission water preserves one saved group and rejects contradictory selection states", () => {
  const pending = {
    ...base,
    status: "pending",
    options: [option],
    contribution: null,
  };
  assert.equal(parseMissionWater(pending).status, "pending");
  const contribution = {
    groupId: option.groupId,
    groupName: option.groupName,
    roundId: option.roundId,
    amount: 1,
  };
  assert.equal(
    parseMissionWater({
      ...base,
      status: "contributed",
      options: [],
      contribution,
    }).status,
    "contributed",
  );
  for (const patch of [
    { options: [] },
    { contribution },
    { options: [option, option] },
    { options: [{ ...option, waterCount: 28, stage: "sunflower" }] },
    { options: [{ ...option, stage: "bud" }] },
    { sourceId: "fake" },
    { koreanDate: "2026-02-30" },
    { reason: "expired" },
  ])
    assert.throws(() => parseMissionWater({ ...pending, ...patch }));
  assert.throws(() =>
    parseMissionWater({
      ...base,
      status: "contributed",
      options: [],
      contribution: { ...contribution, amount: 2 },
    }),
  );
  assert.throws(() =>
    parseMissionWater({
      ...base,
      status: "contributed",
      options: [option],
      contribution,
    }),
  );
});
test("unavailable or expired water stays explicit and never becomes an empty successful selection", () => {
  for (const reason of [
    "no_eligible_missions",
    "not_first_completion",
    "expired",
    "missions_ended",
  ]) {
    const row = {
      ...base,
      status: "unavailable",
      reason,
      options: [],
      contribution: null,
    };
    assert.equal(parseMissionWater(row).status, "unavailable");
    assert.throws(() => parseMissionWater({ ...row, options: [option] }));
  }
  assert.throws(() =>
    parseMissionWater({
      ...base,
      status: "unavailable",
      reason: "success",
      options: [],
      contribution: null,
    }),
  );
});

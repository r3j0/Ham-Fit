import assert from "node:assert/strict";
import { test } from "node:test";
import { selectWelcomeMascots } from "../../lib/welcome-mascots.ts";
import { POSES } from "../../components/hamster/poses.ts";
import type { HamsterPose } from "../../components/hamster/types.ts";

test("welcome draws keep two of each hamster and four distinct non-basic poses", () => {
  const poses = Object.keys(POSES) as HamsterPose[];
  const original = [...poses];
  for (let seed = 1; seed <= 100; seed++) {
    let state = seed;
    const draws = selectWelcomeMascots(poses, () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    });
    assert.equal(draws.length, 4);
    assert.equal(new Set(draws.map((d) => d.pose)).size, 4);
    assert.ok(
      draws.every((d) => String(d.pose) !== "basic" && poses.includes(d.pose)),
    );
    assert.equal(draws.filter((d) => d.variant === "cream").length, 2);
    assert.equal(draws.filter((d) => d.variant === "gray").length, 2);
  }
  assert.deepEqual(poses, original);
  assert.notDeepEqual(
    selectWelcomeMascots(poses, () => 0),
    selectWelcomeMascots(poses, () => 0.99999),
  );
});

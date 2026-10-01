import test from "node:test";
import assert from "node:assert/strict";
import { pageOf } from "../../lib/api-contract.ts";

test("paginated validation preserves parser option defaults instead of passing array indexes", () => {
  const argumentsSeen: number[] = [];
  function parseCapacity(value: unknown, capacityLimit = 5) {
    argumentsSeen.push(arguments.length);
    const group = value as { maxMembers: number };
    if (group.maxMembers > capacityLimit)
      throw new Error("capacity exceeds limit");
    return group;
  }
  const items = [{ maxMembers: 5 }, { maxMembers: 2 }];
  assert.deepEqual(pageOf({ items, nextCursor: null }, parseCapacity), {
    items,
    nextCursor: null,
  });
  assert.deepEqual(argumentsSeen, [1, 1]);
  assert.throws(
    () =>
      pageOf({ items: [{ maxMembers: 6 }], nextCursor: null }, parseCapacity),
    /capacity exceeds limit/,
  );
});

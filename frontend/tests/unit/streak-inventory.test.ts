import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInventory } from "../../lib/shop-contract.ts";

test("개인 룰렛으로 획득한 소유권을 구매·기본 소유권과 함께 조회한다", () => {
  const value = {
    currency: { balance: 25 },
    inventory: [
      {
        productId: "character.cream",
        source: "default",
        acquiredAt: "2026-10-01T00:00:00Z",
      },
      {
        productId: "pose.run",
        source: "streak_roulette",
        acquiredAt: "2026-10-01T01:00:00Z",
      },
    ],
  };
  assert.deepEqual(parseInventory(value), value);
  assert.throws(() =>
    parseInventory({
      ...value,
      inventory: [{ ...value.inventory[1], source: "unknown" }],
    }),
  );
});

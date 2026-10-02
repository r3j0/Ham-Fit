import assert from "node:assert/strict";
import test from "node:test";
import { parseBatchPurchase } from "../../lib/shop-contract.ts";

const items = [
  { productId: "clothing.hat", catalogRevision: 1 },
  { productId: "clothing.top", catalogRevision: 2 },
];
const receipt = () => ({
  replayed: false,
  purchases: items.map((item, i) => ({
    id: `30000000-0000-4000-8000-00000000000${i}`,
    ...item,
    price: i ? 25 : 30,
    createdAt: "2026-10-02T00:00:00.000Z",
  })),
  totalPrice: 55,
  currency: { balance: 45 },
  inventory: items.map(({ productId }) => ({
    productId,
    source: "purchase",
    acquiredAt: "2026-10-02T00:00:00.000Z",
  })),
});

test("batch receipts accept reordered items and replay with current inventory", () => {
  const result = receipt();
  result.purchases.reverse();
  result.replayed = true;
  assert.deepEqual(parseBatchPurchase(result, items), result);
});

for (const [label, corrupt] of [
  [
    "wrong total",
    (r) => {
      r.totalPrice--;
    },
  ],
  [
    "partial purchases",
    (r) => {
      r.purchases.pop();
    },
  ],
  [
    "extra purchase",
    (r) => {
      r.purchases.push(r.purchases[0]);
    },
  ],
  [
    "duplicate product",
    (r) => {
      r.purchases[1].productId = r.purchases[0].productId;
    },
  ],
  [
    "duplicate receipt id",
    (r) => {
      r.purchases[1].id = r.purchases[0].id;
    },
  ],
  [
    "wrong revision",
    (r) => {
      r.purchases[0].catalogRevision++;
    },
  ],
  [
    "missing ownership",
    (r) => {
      r.inventory.pop();
    },
  ],
  [
    "invalid price",
    (r) => {
      r.purchases[0].price = -1;
    },
  ],
  [
    "invalid balance",
    (r) => {
      r.currency.balance = -1;
    },
  ],
] satisfies [string, (r: ReturnType<typeof receipt>) => void][]) {
  test(`batch receipts reject ${label}`, () => {
    const result = receipt();
    corrupt(result);
    assert.throws(() => parseBatchPurchase(result, items));
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  supportedSelection,
  type Catalog,
  type Product,
} from "../../lib/shop-contract.ts";

const selection = {
  characterId: "character.cream",
  poseId: "pose.basic",
  clothingIds: [
    "clothing.set-a-hat",
    "clothing.set-b-top",
    "clothing.set-c-bottom",
  ],
};
const product = (
  id: string,
  kind: Product["kind"],
  slot: Product["slot"] = null,
): Product => ({
  id,
  kind,
  slot,
  occupiesSlots: slot ? [slot] : [],
  renderKey: id,
  ownershipScope: "shared",
  scopeCharacterId: null,
  saleStatus: "retired",
  price: null,
  priceProvisional: false,
  catalogRevision: 1,
});
const catalog = (): Catalog => ({
  products: [
    product(selection.characterId, "character"),
    product(selection.poseId, "pose"),
    product(selection.clothingIds[0], "clothing", "hat"),
    product(selection.clothingIds[1], "clothing", "top"),
    product(selection.clothingIds[2], "clothing", "bottom"),
    product("clothing.other-top", "clothing", "top"),
  ],
  combinations: [
    { ...selection, clothingIds: [] },
    ...[...selection.clothingIds, "clothing.other-top"].map((id) => ({
      ...selection,
      clothingIds: [id],
    })),
  ],
});

test("registered individual layers allow every subset and cross-set replacement, including retired owned items", () => {
  const c = catalog();
  for (let mask = 0; mask < 8; mask++) {
    assert.equal(
      supportedSelection(c, {
        ...selection,
        clothingIds: selection.clothingIds.filter(
          (_, bit) => mask & (1 << bit),
        ),
      }),
      true,
    );
  }
  assert.equal(
    supportedSelection(c, {
      ...selection,
      clothingIds: [
        selection.clothingIds[0],
        "clothing.other-top",
        selection.clothingIds[2],
      ],
    }),
    true,
  );
});
test("mixes require registered artwork for the exact character and pose", () => {
  const c = catalog();
  c.products.push(
    product("character.gray", "character"),
    product("pose.run", "pose"),
  );
  assert.equal(
    supportedSelection(c, { ...selection, characterId: "character.gray" }),
    false,
  );
  assert.equal(
    supportedSelection(c, { ...selection, poseId: "pose.run" }),
    false,
  );
  c.combinations.pop();
  assert.equal(
    supportedSelection(c, {
      ...selection,
      clothingIds: ["clothing.other-top"],
    }),
    false,
  );
});
test("duplicate slots, IDs, unknown products, character-specific layers and combined-slot garments cannot bypass support checks", () => {
  const c = catalog();
  assert.equal(
    supportedSelection(c, {
      ...selection,
      clothingIds: [selection.clothingIds[1], "clothing.other-top"],
    }),
    false,
  );
  assert.equal(
    supportedSelection(c, {
      ...selection,
      clothingIds: [selection.clothingIds[0], selection.clothingIds[0]],
    }),
    false,
  );
  assert.equal(
    supportedSelection(c, { ...selection, clothingIds: ["missing"] }),
    false,
  );
  const top = c.products.find((p) => p.slot === "top")!;
  top.scopeCharacterId = "character.gray";
  top.ownershipScope = "character";
  assert.equal(supportedSelection(c, selection), false);
  top.scopeCharacterId = null;
  top.occupiesSlots = ["top", "bottom"];
  assert.equal(
    supportedSelection(c, {
      ...selection,
      clothingIds: selection.clothingIds.slice(0, 2),
    }),
    false,
  );
});

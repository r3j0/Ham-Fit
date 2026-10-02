import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  avatarSceneRendering,
  avatarRenderSelection,
} from "../../lib/avatar-rendering.ts";
import { resolveHamster } from "../../components/hamster/resolve.ts";
import { POSES } from "../../components/hamster/poses.ts";
import type {
  ItemCatalog,
  HamsterPose,
} from "../../components/hamster/types.ts";
import type { AvatarOutfit } from "../../lib/avatar-outfit.ts";

const catalog: ItemCatalog = JSON.parse(
  readFileSync(
    new URL("../../public/hamsters/wardrobe/catalog.json", import.meta.url),
    "utf8",
  ),
).catalog;
const rendering: AvatarOutfit["rendering"] = {
  variant: "gray",
  pose: "basic",
  clothing: [
    { slot: "hat", renderKey: "beige-hat" },
    { slot: "top", renderKey: "mint-shirt" },
    { slot: "bottom", renderKey: "navy-shorts" },
  ].map(({ slot, renderKey }) => ({
    slot: slot as "hat" | "top" | "bottom",
    renderKey,
    productId: `clothing.${renderKey}`,
    occupiesSlots: [slot as "hat" | "top" | "bottom"],
  })),
};

test("every production pose and character retains all saved clothing layers", () => {
  for (const variant of ["cream", "gray"] as const)
    for (const pose of Object.keys(POSES) as HamsterPose[]) {
      const scene = avatarSceneRendering(
        { ...rendering, variant },
        pose,
        catalog,
      )!;
      assert.equal(scene.pose, pose);
      assert.equal(scene.variant, variant);
      const resolved = resolveHamster(avatarRenderSelection(scene), catalog);
      assert.deepEqual(resolved.warnings, []);
      for (const item of rendering.clothing)
        assert(
          resolved.layers.some((layer) =>
            layer.key.startsWith(`${item.slot}:${item.renderKey}:`),
          ),
        );
    }
});

test("missing scene artwork falls back as a complete outfit, without borrowing another pose or color", () => {
  const limited = Object.fromEntries(
    Object.entries(catalog).map(([id, item]) => [
      id,
      { ...item, poses: { basic: item.poses.basic } },
    ]),
  ) as ItemCatalog;
  assert.deepEqual(
    avatarSceneRendering(rendering, "situp", limited),
    rendering,
  );
  assert.deepEqual(
    avatarSceneRendering(rendering, undefined, limited),
    rendering,
  );
  const wrongColor = Object.fromEntries(
    Object.entries(catalog).map(([id, item]) => [
      id,
      { ...item, poses: { basic: { cream: item.poses.basic?.cream } } },
    ]),
  ) as ItemCatalog;
  assert.equal(avatarSceneRendering(rendering, "situp", wrongColor), null);
  assert.equal(avatarSceneRendering(rendering, "situp", {}), null);
});

test("unclothed members still use the scene pose", () => {
  assert.deepEqual(
    avatarSceneRendering({ ...rendering, clothing: [] }, "pushup", {}),
    { ...rendering, clothing: [], pose: "pushup" },
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { POSES } from "../../components/hamster/poses.ts";
import { DEFAULT_ITEMS } from "../../components/hamster/items.ts";
import { resolveHamster } from "../../components/hamster/resolve.ts";
import type { ItemCatalog } from "../../components/hamster/types.ts";
import {
  canRenderAvatar,
  isExcludedSportswear,
} from "../../lib/avatar-rendering.ts";
import { parseAvatarOutfit } from "../../lib/avatar-outfit.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url));
test("v2 원본과 사용자 지정 기본 캐릭터의 배치·등록 범위를 검증한다", () => {
  const integrity = JSON.parse(
    read("components/hamster/provenance/base-integrity.json").toString(),
  );
  for (const [path, hash] of Object.entries(integrity)) {
    if (path.startsWith("public/") && path.endsWith(".webp"))
      assert.equal(createHash("sha256").update(read(path)).digest("hex"), hash);
  }
  const placements = JSON.parse(
    read("components/hamster/provenance/placements.json").toString(),
  );
  placements.basic.assets.cream.src = "/hamsters/base/basic-cream-hamdoli.svg";
  placements.basic.assets.gray.src = "/hamsters/base/basic-gray-hamkong.svg";
  assert.deepEqual(POSES, placements);
  assert.equal(Object.keys(POSES).length, 16);
  assert.deepEqual(Object.keys(DEFAULT_ITEMS), ["mint-shirt"]);
  const status = JSON.parse(
    read("components/hamster/provenance/CATALOG_STATUS.json").toString(),
  );
  for (const [path, asset] of Object.entries(status.assets) as [
    string,
    { sha256: string },
  ][]) {
    assert.equal(
      createHash("sha256")
        .update(read(`public${path}`))
        .digest("hex"),
      asset.sha256,
    );
  }
});
test("모든 자세·색상에서 의상 프레임을 빌려오지 않고 선택을 유지한다", () => {
  for (const pose of Object.keys(POSES))
    for (const variant of ["cream", "gray"]) {
      const selection = Object.freeze({ pose, variant, top: "mint-shirt" });
      const result = resolveHamster(selection, DEFAULT_ITEMS);
      assert.equal(
        result.layers[0].src,
        pose === "basic"
          ? variant === "cream"
            ? "/hamsters/base/basic-cream-hamdoli.svg"
            : "/hamsters/base/basic-gray-hamkong.svg"
          : `/hamsters/base/${pose}-${variant}.webp`,
      );
      assert.equal(result.layers.length, pose === "basic" ? 2 : 1);
      assert.equal(result.warnings.length, pose === "basic" ? 0 : 1);
      assert.equal(selection.top, "mint-shirt");
    }
});
test("독립 슬롯의 전경 순서와 잘못된 슬롯·깨진 레이어의 생략을 검증한다", () => {
  const catalog: ItemCatalog = Object.fromEntries(
    ["hat", "top", "bottom"].map((slot, i) => [
      slot,
      {
        slot,
        label: slot,
        poses: {
          basic: {
            cream: {
              layers: [{ src: `/test/${slot}.png`, zIndex: 30 - i * 10 }],
              foreground: [{ src: `/test/${slot}-front.png`, zIndex: 40 + i }],
            },
          },
        },
      },
    ]),
  ) as ItemCatalog;
  const result = resolveHamster(
    { hat: "hat", top: "top", bottom: "bottom" },
    catalog,
  );
  assert.deepEqual(
    result.layers.map((l) => l.zIndex),
    [0, 10, 20, 30, 40, 41, 42],
  );
  assert.equal(resolveHamster({ hat: "top" }, catalog).layers.length, 1);
  const bad: ItemCatalog = {
    bad: {
      slot: "top",
      label: "bad",
      poses: {
        basic: {
          cream: { layers: [{ src: "javascript:alert(1)", zIndex: 20 }] },
        },
      },
    },
  };
  assert.equal(resolveHamster({ top: "bad" }, bad).layers.length, 1);
});
test("기존 미지원 코디는 API에서 읽되 다른 그림으로 위장하지 않는다", () => {
  const outfit = parseAvatarOutfit({
    characterId: "character.cream",
    poseId: "pose.a-plus",
    revision: 1,
    updatedAt: "2026-10-01T00:00:00Z",
    clothingIds: [],
    rendering: { variant: "cream", pose: "a-plus", clothing: [] },
  });
  assert.equal(canRenderAvatar(outfit.rendering), false);
  for (const pose of Object.keys(POSES)) {
    const supported = parseAvatarOutfit({
      ...outfit,
      poseId: `pose.${pose}`,
      rendering: { ...outfit.rendering, pose },
    });
    assert.equal(canRenderAvatar(supported.rendering), true);
  }
  assert.equal(
    canRenderAvatar({
      variant: "cream",
      pose: "basic",
      clothing: [
        {
          productId: "old",
          renderKey: "blue-sportswear",
          slot: "top",
          occupiesSlots: ["top", "bottom"],
        },
      ],
    }),
    false,
  );
  for (const key of ["blue", "black", "white", "green"]) {
    assert.equal(isExcludedSportswear(`${key}-sportswear`), true);
    assert.equal(isExcludedSportswear(`clothing.${key}-sportswear`), true);
  }
  assert.equal(isExcludedSportswear("mint-shirt"), false);
});

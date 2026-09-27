import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MASCOT_POSES,
  getMascotPose,
} from "../../components/mascot/mascot-poses.js";
import { WARDROBE, normalizeOutfit } from "../../components/mascot/wardrobe.js";

test("130개 캐릭터·자세·의상 조합은 원본 해시와 안전한 표시 영역을 유지한다", () => {
  assert.equal(MASCOT_POSES.length, 13);
  assert.equal(WARDROBE.length, 4);
  const checked = new Set<string>();
  for (const pose of MASCOT_POSES)
    for (const variant of ["cream", "gray"] as const)
      for (const outfit of [{}, ...WARDROBE.map(({ id }) => ({ wear: id }))]) {
        const art = getMascotPose(pose.id, variant, "/mascots/poses", outfit);
        if (!checked.has(art.src)) {
          const bytes = readFileSync(
            new URL(`../../public${art.src}`, import.meta.url),
          );
          assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            art.sha256,
          );
          checked.add(art.src);
        }
        const [x, y, w, h] = art.viewport;
        const [bx, by, bw, bh] = art.artBounds;
        assert.ok(Math.abs(w / h - 0.8) < 0.00001);
        assert.ok(bx >= x && by >= y && bx + bw <= x + w && by + bh <= y + h);
        assert.ok(art.clip.every(Number.isFinite));
      }
  assert.equal(checked.size, 65);
  assert.ok(
    getMascotPose("lying", "cream", undefined, { wear: "white-sportswear" })
      .clipPolygon,
  );
  assert.deepEqual(normalizeOutfit({ wear: "retired-item", hat: "cap" }), {});
});

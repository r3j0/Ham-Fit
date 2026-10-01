import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRenderCatalog } from "../../lib/avatar-catalog.ts";
import { canRenderAvatar } from "../../lib/avatar-rendering.ts";
import { resolveHamster } from "../../components/hamster/resolve.ts";
const src = `/hamsters/wardrobe/assets/${"a".repeat(64)}.png`;
const payload = () => ({
  revision: 3,
  catalog: {
    "new-shirt": {
      slot: "top",
      label: "New shirt",
      poses: {
        basic: {
          cream: {
            layers: [
              {
                src,
                x: 35,
                y: 60,
                width: 900,
                height: 850,
                rotation: 12,
                fit: "stretch",
                zIndex: 20,
              },
            ],
          },
        },
      },
    },
  },
});
test("frontend catalog supplies same-origin static paths and saved geometry", () => {
  const { catalog } = parseRenderCatalog(payload());
  const rendering = {
    variant: "cream" as const,
    pose: "basic" as const,
    clothing: [
      {
        productId: "clothing.new-shirt",
        renderKey: "new-shirt",
        slot: "top" as const,
        occupiesSlots: ["top" as const],
      },
    ],
  };
  assert.equal(canRenderAvatar(rendering, catalog), true);
  assert.equal(canRenderAvatar(rendering, {}), false);
  assert.deepEqual(resolveHamster({ top: "new-shirt" }, catalog).layers[1], {
    key: "top:new-shirt:0",
    src: src,
    x: 35,
    y: 60,
    width: 900,
    height: 850,
    rotation: 12,
    fit: "stretch",
    zIndex: 20,
  });
});
test("empty catalog stays empty; malformed images and coordinates are rejected", () => {
  assert.deepEqual(
    parseRenderCatalog({ revision: 0, catalog: {} }).catalog,
    {},
  );
  const bad = payload();
  bad.catalog["new-shirt"].poses.basic.cream.layers[0].src =
    "https://external.test/png";
  assert.throws(() => parseRenderCatalog(bad));
  const invalid = payload();
  invalid.catalog["new-shirt"].poses.basic.cream.layers[0].width = -1;
  assert.throws(() => parseRenderCatalog(invalid));
});

test("historical API image hashes resolve on the frontend without a backend image request", () => {
  const data = payload();
  data.catalog["new-shirt"].poses.basic.cream.layers[0].src = src.replace(
    "/hamsters/wardrobe/assets/",
    "/api/v1/avatar/assets/",
  );
  assert.equal(
    parseRenderCatalog(data).catalog["new-shirt"].poses.basic!.cream!.layers[0]
      .src,
    src,
  );
});

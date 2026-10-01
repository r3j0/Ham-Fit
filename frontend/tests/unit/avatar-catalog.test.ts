import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRenderCatalog } from "../../lib/avatar-catalog.ts";
import { canRenderAvatar } from "../../lib/avatar-rendering.ts";
import { resolveHamster } from "../../components/hamster/resolve.ts";
const src = `/api/v1/avatar/assets/${"a".repeat(64)}.png`;
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
test("server catalog supplies image URLs and saved geometry without a frontend rebuild", () => {
  const { catalog } = parseRenderCatalog(
    payload(),
    "https://api.example.test/api/v1",
  );
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
    src: `https://api.example.test${src}`,
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
    parseRenderCatalog(
      { revision: 0, catalog: {} },
      "http://localhost:3001/api/v1",
    ).catalog,
    {},
  );
  const bad = payload();
  bad.catalog["new-shirt"].poses.basic.cream.layers[0].src =
    "https://external.test/png";
  assert.throws(() => parseRenderCatalog(bad, "http://localhost:3001/api/v1"));
  const invalid = payload();
  invalid.catalog["new-shirt"].poses.basic.cream.layers[0].width = -1;
  assert.throws(() =>
    parseRenderCatalog(invalid, "http://localhost:3001/api/v1"),
  );
});

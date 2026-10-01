import { object, integer, invalid } from "./api-contract.ts";
import { POSES } from "../components/hamster/poses.ts";
import { resolveHamster } from "../components/hamster/resolve.ts";
import type { HamsterPose, ItemCatalog } from "../components/hamster/types.ts";

export function parseRenderCatalog(value: unknown) {
  const body = object(value),
    catalog = object(body.catalog);
  if (!integer(body.revision, 0)) invalid();
  for (const [id, value] of Object.entries(catalog)) {
    const item = object(value),
      poses = object(item.poses);
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
      !["hat", "top", "bottom"].includes(String(item.slot)) ||
      typeof item.label !== "string" ||
      !item.label.trim() ||
      !Object.keys(poses).length
    )
      invalid();
    for (const [pose, variantsValue] of Object.entries(poses)) {
      if (!Object.hasOwn(POSES, pose)) invalid();
      for (const [variant, frameValue] of Object.entries(
        object(variantsValue),
      )) {
        if (!["cream", "gray", "shared"].includes(variant)) invalid();
        const frame = object(frameValue);
        if (
          !Array.isArray(frame.layers) ||
          !frame.layers.length ||
          (frame.foreground !== undefined && !Array.isArray(frame.foreground))
        )
          invalid();
        for (const value of [
          ...frame.layers,
          ...((frame.foreground as unknown[]) ?? []),
        ]) {
          const layer = object(value);
          if (
            typeof layer.src !== "string" ||
            !/^\/(?:hamsters\/wardrobe\/assets|api\/v1\/avatar\/assets)\/[a-f0-9]{64}\.png$/.test(
              layer.src,
            )
          )
            invalid();
          // Preserve historical hashes while serving every PNG from this frontend.
          layer.src = layer.src.replace(
            "/api/v1/avatar/assets/",
            "/hamsters/wardrobe/assets/",
          );
        }
        const selection = {
          pose: pose as HamsterPose,
          variant: variant === "shared" ? "cream" : variant,
          [String(item.slot)]: id,
        };
        if (
          resolveHamster(selection, catalog as unknown as ItemCatalog).warnings
            .length
        )
          invalid();
      }
    }
  }
  return {
    revision: body.revision as number,
    catalog: catalog as unknown as ItemCatalog,
  };
}

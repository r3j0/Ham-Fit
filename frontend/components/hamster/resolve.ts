import { POSES, DEFAULT_POSE } from "./poses.ts";
import type {
  HamsterPose,
  HamsterSlot,
  HamsterVariant,
  ItemCatalog,
  LayerAsset,
  RenderSelection,
  ResolvedLayer,
} from "./types.ts";

/** Accept image URLs only. Imported production catalogs are always local, exact PNG paths. */
export function isSafeImageSource(src: unknown): src is string {
  return (
    typeof src === "string" &&
    !!src &&
    !/[\u0000-\u0020\\]/.test(src) &&
    (/^\/(?!\/)/.test(src) || /^https?:\/\/[^/]+\//i.test(src)) &&
    !src.split("/").some((part) => part === ".." || part === ".")
  );
}
function validLayer(layer: LayerAsset) {
  if (!layer || !isSafeImageSource(layer.src) || !Number.isFinite(layer.zIndex))
    return false;
  for (const name of [
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
  ] as const)
    if (layer[name] !== undefined && !Number.isFinite(layer[name]))
      return false;
  return (
    (layer.width === undefined || layer.width > 0) &&
    (layer.height === undefined || layer.height > 0) &&
    (layer.opacity === undefined || (layer.opacity >= 0 && layer.opacity <= 1))
  );
}
export function resolveHamster(
  selection: RenderSelection,
  catalog: ItemCatalog,
) {
  const warnings: string[] = [];
  const pose = Object.hasOwn(POSES, selection.pose ?? "")
    ? (selection.pose as HamsterPose)
    : DEFAULT_POSE;
  const variant: HamsterVariant =
    selection.variant === "gray" ? "gray" : "cream";
  if (selection.pose && pose !== selection.pose)
    warnings.push(`Unknown pose: ${selection.pose}; using ${pose}`);
  if (selection.variant && !["cream", "gray"].includes(selection.variant))
    warnings.push(`Unknown variant: ${selection.variant}; using cream`);
  const layers: ResolvedLayer[] = [
    { key: "base", ...POSES[pose].assets[variant], zIndex: 0 },
  ];
  const requests: [HamsterSlot, string | null | undefined][] = [
    ["bottom", selection.bottom],
    ["top", selection.top],
    ["hat", selection.hat],
    ...[
      ...new Set(
        Array.isArray(selection.accessories) ? selection.accessories : [],
      ),
    ].map((id) => ["accessory", id] as [HamsterSlot, string]),
  ];
  for (const [slot, id] of requests) {
    if (!id) continue;
    const item =
      catalog && Object.hasOwn(catalog, id) ? catalog[id] : undefined;
    if (!item || item.slot !== slot) {
      warnings.push(`Unavailable ${slot}: ${id}`);
      continue;
    }
    const registration = item.poses?.[pose];
    // 'shared' is an explicitly authored same-pose asset; never use the other color or pose.
    const frame = registration?.[variant] ?? registration?.shared;
    if (!frame || !Array.isArray(frame.layers) || frame.layers.length === 0) {
      warnings.push(`${id} has no ${pose}/${variant} asset; omitted`);
      continue;
    }
    const foreground = Array.isArray(frame.foreground) ? frame.foreground : [];
    const candidates = [...frame.layers, ...foreground];
    // Omit the whole garment if any layer is malformed. Never render hands with a missing garment.
    if (candidates.some((layer) => !validLayer(layer))) {
      warnings.push(`Invalid layers for ${slot}: ${id}; omitted`);
      continue;
    }
    candidates.forEach((layer, index) =>
      layers.push({ ...layer, key: `${slot}:${id}:${index}` }),
    );
  }
  layers.sort((a, b) => a.zIndex - b.zIndex);
  return { pose, variant, layers, warnings };
}
export function assetUrl(src: string, prefix = ""): string {
  if (!src.startsWith("/") || src.startsWith("//")) return src;
  if (
    prefix &&
    (!/^\/(?!\/)/.test(prefix) ||
      /[?#\s\\]/.test(prefix) ||
      prefix.split("/").some((part) => part === ".." || part === "."))
  )
    return src;
  return `${prefix.replace(/\/$/, "")}${src}`;
}

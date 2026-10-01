"use client";
import { useId } from "react";
import type { AvatarOutfit } from "@/lib/avatar-outfit";
import { clothingPlacement, wardrobeBase } from "@/lib/wardrobe-assets";
import { MascotPose } from "./mascot/MascotPose";

export function ProfileCharacter({
  outfit,
  size,
  label,
}: {
  outfit: AvatarOutfit | null;
  size: number;
  label: string;
}) {
  const uid = useId();
  if (outfit?.rendering.clothing.length) {
    const { variant, pose, clothing } = outfit.rendering;
    const base = wardrobeBase(pose);
    const layers = [...clothing]
      .sort(
        (a, b) =>
          ["bottom", "top", "hat"].indexOf(a.slot) -
          ["bottom", "top", "hat"].indexOf(b.slot),
      )
      .map((item) => ({
        item,
        placement: clothingPlacement(item.renderKey, pose, variant),
      }));
    if (!base || layers.some((layer) => !layer.placement))
      return (
        <span
          className="character-unavailable"
          role="img"
          aria-label={`${label} · 코디 이미지 준비 중`}
        >
          코디 이미지 준비 중
        </span>
      );
    const [x, y, w, h] = base.clips[variant];
    return (
      <span
        className="wardrobe-character"
        style={{ width: size }}
        role="img"
        aria-label={label}
      >
        <svg
          viewBox={base.viewports[variant].join(" ")}
          aria-hidden="true"
          width="800"
          height="1000"
        >
          <defs>
            <clipPath id={uid}>
              <rect x={x} y={y} width={w} height={h} />
            </clipPath>
          </defs>
          <image
            href={base.src}
            width={base.width}
            height={base.height}
            clipPath={`url(#${uid})`}
          />
        </svg>
        {layers.map(({ item, placement }) => {
          const p = placement!;
          return (
            <svg
              key={item.productId}
              aria-hidden="true"
              className="wardrobe-layer"
              viewBox={`0 0 ${p.naturalWidth} ${p.naturalHeight}`}
              style={{
                left: `${50 + p.transform.x}%`,
                top: `${50 + p.transform.y}%`,
                width: `${p.transform.width}%`,
                transform: `translate(-50%, -50%) rotate(${p.transform.rotation}deg)`,
              }}
            >
              <image
                href={p.src}
                width={p.naturalWidth}
                height={p.naturalHeight}
              />
            </svg>
          );
        })}
      </span>
    );
  }
  return (
    <MascotPose
      variant={outfit?.rendering.variant ?? "cream"}
      pose={outfit?.rendering.pose ?? "basic"}
      size={size}
      label={label}
    />
  );
}

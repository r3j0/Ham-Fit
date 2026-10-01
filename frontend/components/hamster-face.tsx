import { useId } from "react";
import { POSES } from "./hamster/poses";
import type { HamsterVariant } from "./hamster/types";

/** Crop the supplied basic artwork for a face-only character switch. */
export function HamsterFace({ variant }: { variant: HamsterVariant }) {
  const clipId = useId();
  const art = POSES.basic.assets[variant];
  return (
    <svg
      viewBox="235 230 530 435"
      width="58"
      height="48"
      aria-hidden="true"
      focusable="false"
      data-face-variant={variant}
    >
      <defs>
        <clipPath id={clipId}>
          <path
            d={
              variant === "cream"
                ? "M235 230H765V570Q750 610 697 625C640 659 583 666 500 666C418 666 361 653 307 623Q249 601 235 570Z"
                : "M235 230H765V560Q723 601 660 631Q642 658 550 666H450Q373 663 339 632Q270 597 235 560Z"
            }
          />
        </clipPath>
      </defs>
      <image
        href={art.src}
        x={art.x}
        y={art.y}
        width={art.width}
        height={art.height}
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}

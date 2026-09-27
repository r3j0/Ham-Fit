"use client";

import { useId, type CSSProperties } from "react";
import { getImageProps } from "next/image";
import { getMascotPose, type MascotPoseOptions } from "./mascot-poses.js";
import { WARDROBE } from "./wardrobe.js";
import styles from "./MascotPose.module.css";

export type MascotPoseProps = MascotPoseOptions & { className?: string };

/** Declarative adapter for the private kit's calibrated pose/outfit renderer. */
export function MascotPose({
  pose = "basic",
  variant = "cream",
  assetBasePath = "/mascots/poses",
  size = 160,
  label,
  outfit = {},
  className,
}: MascotPoseProps) {
  const uid = useId();
  const art = getMascotPose(pose, variant, assetBasePath, outfit);
  const width = Number.isFinite(size)
    ? Math.min(2000, Math.max(24, size))
    : 160;
  const [x, y, clipWidth, clipHeight] = art.clip;
  const title =
    label ??
    `${variant === "cream" ? "크림" : "그레이"} 햄스터 · ${art.label}${art.outfit.wear ? " · " + WARDROBE.find((item) => item.id === art.outfit.wear)?.label : ""}`;
  // Optimize the selected sheet at the displayed crop's resolution, without changing its geometry.
  const imageWidth = Math.ceil((width * art.width) / art.viewport[2]);
  const { props: image } = getImageProps({
    src: art.src,
    alt: "",
    width: imageWidth,
    height: Math.round((imageWidth * art.height) / art.width),
  });
  return (
    <span
      className={[styles.mascot, className].filter(Boolean).join(" ")}
      style={{ "--pose-size": `${width}px` } as CSSProperties}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      data-pose={pose}
      data-variant={variant}
      data-wear={art.outfit.wear ?? "none"}
    >
      <svg
        viewBox={art.viewBox}
        width="800"
        height="1000"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <clipPath id={uid} clipPathUnits="userSpaceOnUse">
            {art.clipPolygon ? (
              <polygon points={art.clipPolygon} />
            ) : (
              <rect x={x} y={y} width={clipWidth} height={clipHeight} />
            )}
          </clipPath>
        </defs>
        <image
          href={image.src}
          width={art.width}
          height={art.height}
          clipPath={`url(#${uid})`}
        />
      </svg>
    </span>
  );
}

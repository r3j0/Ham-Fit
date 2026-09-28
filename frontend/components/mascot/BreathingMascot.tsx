"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createBreathingRig, type RigController } from "./breathing-rig.js";
import { HeadArtwork } from "./HeadArtwork";
import { RIG_SHAPES } from "./rig-shapes.js";
import styles from "./BreathingMascot.module.css";

export type BreathingMascotProps = {
  motion?: "idle" | "walk";
  framing?: "full" | "face";
  variant?: "cream" | "gray";
  /** Copy the two *-belly.svg assets into this public directory. Heads are live SVG paths. */
  assetBasePath?: string;
  size?: number;
  cycleSeconds?: number;
  intensity?: number;
  paused?: boolean;
  /** Empty string makes the mascot decorative. */
  label?: string;
  className?: string;
};

export function BreathingMascot({
  variant = "cream",
  framing = "full",
  assetBasePath = "/mascots",
  size = 240,
  motion = "idle",
  cycleSeconds = motion === "walk" ? 1.2 : 5.6,
  intensity = 1,
  paused = false,
  label,
  className,
}: BreathingMascotProps) {
  const svg = useRef<SVGSVGElement>(null);
  const controller = useRef<RigController | null>(null);
  const shape = RIG_SHAPES[variant];
  const description =
    label ??
    (motion === "walk"
      ? "발과 팔을 번갈아 움직이며 제자리 걷는 햄스터"
      : "머리와 팔이 호흡을 따라 움직이는 햄스터");
  const base = assetBasePath.replace(/\/+$/, "");
  const style = {
    "--idle-size": `${Number.isFinite(size) ? Math.max(24, Math.min(2000, size)) : 240}px`,
  } as CSSProperties;
  // Reset only when geometry changes; pausing and tuning preserve the pose.
  useEffect(() => {
    if (!svg.current) return;
    const rig = createBreathingRig(svg.current, { paused: true });
    controller.current = rig;
    return () => {
      rig.destroy();
      controller.current = null;
    };
  }, [variant]);
  useEffect(() => {
    controller.current?.update({ motion, cycleSeconds, intensity, paused });
  }, [variant, motion, cycleSeconds, intensity, paused]);

  return (
    <span
      className={[styles.mascot, framing === "face" && styles.face, className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      role={description ? "img" : undefined}
      aria-label={description || undefined}
      aria-hidden={description ? undefined : true}
    >
      <svg
        ref={svg}
        className={styles.rig}
        viewBox={framing === "face" ? "0 -40 800 800" : "0 0 800 1000"}
        aria-hidden="true"
        focusable="false"
      >
        <ellipse
          cx="400"
          cy="916"
          rx="191"
          ry="15"
          fill="#64534a"
          opacity=".1"
        />
        <g data-part="left-arm" data-pivot={shape.leftPivot.join(",")}>
          <path
            d={shape.leftArm}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth="14"
            strokeLinejoin="round"
          />
        </g>
        <g data-part="right-arm" data-pivot={shape.rightPivot.join(",")}>
          <path
            d={shape.rightArm}
            fill={shape.fill}
            stroke={shape.stroke}
            strokeWidth="14"
            strokeLinejoin="round"
          />
        </g>
        <path data-part="torso-fill" d={shape.body} fill={shape.fill} />
        <g data-part="belly">
          <image
            href={`${base}/${variant}-belly.svg`}
            width="800"
            height="1000"
          />
        </g>
        <path
          data-part="torso"
          d={shape.outline}
          fill="none"
          stroke={shape.stroke}
          strokeWidth="14"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <g data-part="head">
          <HeadArtwork variant={variant} />
        </g>
      </svg>
    </span>
  );
}

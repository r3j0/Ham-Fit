import type { CSSProperties } from "react";
import { Hamster } from "../hamster/Hamster";
import { POSES } from "../hamster/poses";
import type {
  HamsterPose,
  HamsterVariant,
  HamsterProps,
  ItemCatalog,
} from "../hamster/types";
import styles from "./MascotPose.module.css";

export type MascotPoseProps = Pick<
  HamsterProps<ItemCatalog>,
  "hat" | "top" | "bottom" | "catalog"
> & {
  pose?: HamsterPose;
  variant?: HamsterVariant;
  size?: number;
  label?: string;
  className?: string;
};

/** Service-sized adapter for hamster-outputter-v2's transparent renderer. */
export function MascotPose({
  pose = "basic",
  variant = "cream",
  size = 160,
  label,
  className,
  hat,
  top,
  bottom,
  catalog,
}: MascotPoseProps) {
  const width = Number.isFinite(size)
    ? Math.min(2000, Math.max(24, size))
    : 160;
  const title =
    label ??
    `${variant === "cream" ? "햄돌이" : "햄콩이"} · ${POSES[pose].label}`;
  return (
    <span
      className={[styles.mascot, className].filter(Boolean).join(" ")}
      style={{ "--pose-size": `${width * 1.4}px` } as CSSProperties}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      data-pose={pose}
      data-variant={variant}
      data-wear={hat || top || bottom ? "outfit" : "none"}
    >
      <Hamster
        pose={pose}
        variant={variant}
        hat={hat}
        top={top}
        bottom={bottom}
        catalog={catalog ?? {}}
        decorative
      />
    </span>
  );
}

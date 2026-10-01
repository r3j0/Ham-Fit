import type { ReactElement, CSSProperties } from "react";
import type { ItemCatalog, HamsterProps, RenderSelection } from "./types.ts";
import { DEFAULT_ITEMS } from "./items.ts";
import { POSES } from "./poses.ts";
import { assetUrl, resolveHamster } from "./resolve.ts";

/** Pure presentational component: Server Component compatible, also importable by Client Components. */
export function Hamster(props: HamsterProps): ReactElement;
export function Hamster<C extends ItemCatalog>(
  props: HamsterProps<C> & { catalog: C },
): ReactElement;
export function Hamster({
  variant = "cream",
  pose,
  hat,
  top,
  bottom,
  accessories = [],
  catalog,
  assetPrefix = "",
  className,
  style,
  label,
  decorative = false,
}: RenderSelection & {
  catalog?: ItemCatalog;
  assetPrefix?: string;
  className?: string;
  style?: CSSProperties;
  label?: string;
  decorative?: boolean;
}) {
  const resolved = resolveHamster(
    { variant, pose, hat, top, bottom, accessories },
    catalog ?? DEFAULT_ITEMS,
  );
  const name =
    label ??
    `${resolved.variant === "cream" ? "햄돌이" : "햄콩이"} · ${POSES[resolved.pose].label}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      className={className}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      focusable="false"
      data-hamster-pose={resolved.pose}
      data-hamster-variant={resolved.variant}
      data-hamster-warnings={resolved.warnings.length || undefined}
    >
      {!decorative && <title>{name}</title>}
      {resolved.layers.map((layer) => {
        const {
          x = 0,
          y = 0,
          width = 1000,
          height = 1000,
          rotation = 0,
          opacity = 1,
        } = layer;
        return (
          <image
            key={layer.key}
            data-layer={layer.key}
            href={assetUrl(layer.src, assetPrefix)}
            x={x}
            y={y}
            width={width}
            height={height}
            opacity={opacity}
            transform={
              rotation
                ? `rotate(${rotation} ${x + width / 2} ${y + height / 2})`
                : undefined
            }
            preserveAspectRatio={
              layer.fit === "stretch" ? "none" : "xMidYMid meet"
            }
          />
        );
      })}
    </svg>
  );
}

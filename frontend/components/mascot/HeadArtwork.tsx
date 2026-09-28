"use client";

import { useId } from "react";
import { HEAD_ARTWORK } from "./head-artwork.js";

/** Live vector paths stay crisp while the parent head group rotates. */
export function HeadArtwork({ variant }: { variant: "cream" | "gray" }) {
  const id = `head-color-${useId().replace(/:/g, "")}`;
  const art = HEAD_ARTWORK[variant];
  return (
    <>
      <defs>
        <clipPath id={id}>
          <path d={art.silhouette} />
        </clipPath>
      </defs>
      <path d={art.silhouette} fill={art.fill} />
      <g clipPath={`url(#${id})`}>
        {art.colors.map((path, index) => (
          <path key={index} d={path.d} fill={path.fill} />
        ))}
      </g>
      {art.features.map((path, index) => (
        <path key={index} d={path.d} fill={path.fill} />
      ))}
      <path
        d={art.outline}
        fill="none"
        stroke={art.ink}
        strokeWidth="15.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

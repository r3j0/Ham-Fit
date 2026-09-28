export type HeadShape = {
  silhouette: string;
  outline: string;
  fill: string;
  ink: string;
  colors: { d: string; fill: string }[];
  features: { d: string; fill: string }[];
};
export const HEAD_ARTWORK: Record<"cream" | "gray", HeadShape>;

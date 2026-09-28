export type RigShape = {
  fill: string;
  stroke: string;
  body: string;
  outline: string;
  leftArm: string;
  rightArm: string;
  leftPivot: [number, number];
  rightPivot: [number, number];
};
export const RIG_SHAPES: Record<"cream" | "gray", RigShape>;

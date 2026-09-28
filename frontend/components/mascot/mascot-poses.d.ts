export type MascotPoseId =
  | "basic"
  | "curious"
  | "a-plus"
  | "drink"
  | "lying"
  | "stretch"
  | "run"
  | "passion"
  | "victory"
  | "pushup"
  | "situp"
  | "droopy"
  | "cant-hear";
export type MascotVariant = "cream" | "gray";
export type PoseCategory = "basic" | "emotion" | "exercise" | "rest";
export type PoseViewport = readonly [number, number, number, number];
export type PoseDefinition = {
  readonly id: MascotPoseId;
  readonly label: string;
  readonly category: PoseCategory;
  readonly description: string;
  readonly file: string;
  readonly sourceName: string;
  readonly width: number;
  readonly height: number;
  readonly background: "white";
  readonly bounds: Readonly<Record<MascotVariant, PoseViewport>>;
  readonly clips: Readonly<Record<MascotVariant, PoseViewport>>;
  readonly backgroundEdited: boolean;
  readonly sourceSha256: string;
  readonly viewports: Readonly<Record<MascotVariant, PoseViewport>>;
  readonly sha256: string;
};
export const MASCOT_POSES: readonly PoseDefinition[];
export const POSE_CATEGORIES: readonly { id: PoseCategory; label: string }[];
export type PoseOutfit = import("./wardrobe.js").Outfit;
export type MascotPoseOptions = {
  outfit?: PoseOutfit;
  pose?: MascotPoseId;
  variant?: MascotVariant;
  assetBasePath?: string;
  size?: number;
  /** Empty string makes the image decorative. */ label?: string;
};
export function getMascotPose(
  pose: MascotPoseId,
  variant?: MascotVariant,
  assetBasePath?: string,
  outfit?: PoseOutfit,
): PoseDefinition & {
  variant: MascotVariant;
  outfit: PoseOutfit;
  src: string;
  viewBox: string;
  viewport: PoseViewport;
  clip: PoseViewport;
  clipPolygon: string | null;
  artBounds: PoseViewport;
};
export function createMascotPose(
  container: Element,
  options?: MascotPoseOptions,
): {
  element: SVGSVGElement;
  update(options: Partial<MascotPoseOptions>): void;
  getState(): MascotPoseOptions & { animated: false };
  destroy(): void;
};

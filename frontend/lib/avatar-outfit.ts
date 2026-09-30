import { invalid, integer, object, timestamp } from "./api-contract.ts";
import type {
  MascotPoseId,
  MascotVariant,
} from "../components/mascot/mascot-poses.js";

const poses = [
  "basic",
  "curious",
  "a-plus",
  "drink",
  "lying",
  "stretch",
  "run",
  "passion",
  "victory",
  "pushup",
  "situp",
  "droopy",
  "cant-hear",
];
export interface AvatarOutfit {
  characterId: string;
  poseId: string;
  clothingIds: string[];
  revision: number;
  updatedAt: string;
  rendering: { variant: MascotVariant; pose: MascotPoseId; clothing: [] };
}

/** Only render server identifiers supported by the current asset layer. */
export function parseAvatarOutfit(value: unknown): AvatarOutfit {
  const row = object(value),
    rendering = object(row.rendering);
  if (
    !["cream", "gray"].includes(String(rendering.variant)) ||
    !poses.includes(String(rendering.pose)) ||
    row.characterId !== `character.${rendering.variant}` ||
    row.poseId !== `pose.${rendering.pose}` ||
    !Array.isArray(row.clothingIds) ||
    row.clothingIds.length !== 0 ||
    !Array.isArray(rendering.clothing) ||
    rendering.clothing.length !== 0 ||
    !integer(row.revision, 1) ||
    !timestamp(row.updatedAt)
  )
    invalid();
  return row as unknown as AvatarOutfit;
}

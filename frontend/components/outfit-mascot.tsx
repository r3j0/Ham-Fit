"use client";
import type { AvatarOutfit } from "@/lib/avatar-outfit";
import {
  avatarRenderSelection,
  avatarSceneRendering,
} from "@/lib/avatar-rendering";
import { useAvatarCatalog } from "./avatar-catalog-provider";
import { MascotPose, type MascotPoseProps } from "./mascot/MascotPose";

export type OutfitMascotProps = Pick<
  MascotPoseProps,
  "pose" | "size" | "label" | "className"
>;

export function OutfitMascot({
  rendering,
  pose,
  ...props
}: OutfitMascotProps & { rendering: AvatarOutfit["rendering"] }) {
  const assets = useAvatarCatalog();
  if (rendering.clothing.length && !assets.catalog)
    return (
      <span className="character-unavailable" role="status">
        {assets.error && props.label === "" ? (
          "의상을 불러오지 못했어요"
        ) : assets.error ? (
          <button type="button" onClick={assets.reload}>
            의상 다시 불러오기
          </button>
        ) : (
          "의상 불러오는 중"
        )}
      </span>
    );
  const scene = avatarSceneRendering(rendering, pose, assets.catalog ?? {});
  if (!scene)
    return (
      <span className="character-unavailable" role="status">
        코디 이미지 준비 중
      </span>
    );
  return (
    <MascotPose
      {...props}
      {...avatarRenderSelection(scene)}
      catalog={assets.catalog ?? {}}
    />
  );
}

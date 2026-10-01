"use client";
import type { AvatarOutfit } from "@/lib/avatar-outfit";
import { avatarRenderSelection, canRenderAvatar } from "@/lib/avatar-rendering";
import { Hamster } from "./hamster/Hamster";
import { useAvatarCatalog } from "./avatar-catalog-provider";

export function ProfileCharacter({
  outfit,
  size,
  label,
}: {
  outfit: AvatarOutfit | null;
  size: number;
  label: string;
}) {
  const assets = useAvatarCatalog();
  if (outfit?.rendering.clothing.length && !assets.catalog)
    return (
      <span className="character-unavailable" role="status">
        {assets.error ? (
          <button onClick={assets.reload}>의상 다시 불러오기</button>
        ) : (
          "의상 불러오는 중"
        )}
      </span>
    );
  if (outfit && !canRenderAvatar(outfit.rendering, assets.catalog ?? {}))
    return (
      <span
        className="character-unavailable"
        role={label ? "img" : undefined}
        aria-label={label ? `${label} · 코디 이미지 준비 중` : undefined}
        aria-hidden={label ? undefined : true}
      >
        코디 이미지 준비 중
      </span>
    );
  return (
    <span
      className="profile-character"
      style={{ width: size * 1.4 }}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-pose={outfit?.rendering.pose ?? "basic"}
      data-variant={outfit?.rendering.variant ?? "cream"}
      data-wear="none"
    >
      <Hamster
        {...(outfit ? avatarRenderSelection(outfit.rendering) : {})}
        catalog={assets.catalog ?? {}}
        decorative
      />
    </span>
  );
}

import type { AvatarOutfit } from "@/lib/avatar-outfit";
import { avatarRenderSelection, canRenderAvatar } from "@/lib/avatar-rendering";
import { Hamster } from "./hamster/Hamster";
import { DEFAULT_ITEMS } from "./hamster/items";

export function ProfileCharacter({
  outfit,
  size,
  label,
}: {
  outfit: AvatarOutfit | null;
  size: number;
  label: string;
}) {
  if (outfit && !canRenderAvatar(outfit.rendering))
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
      style={{ width: size }}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-pose={outfit?.rendering.pose ?? "basic"}
      data-variant={outfit?.rendering.variant ?? "cream"}
      data-wear="none"
    >
      <Hamster
        {...(outfit ? avatarRenderSelection(outfit.rendering) : {})}
        catalog={DEFAULT_ITEMS}
        decorative
      />
    </span>
  );
}

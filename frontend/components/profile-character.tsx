import type { AvatarOutfit } from "@/lib/avatar-outfit";
import { MascotPose } from "./mascot/MascotPose";

export function ProfileCharacter({
  outfit,
  size,
  label,
}: {
  outfit: AvatarOutfit | null;
  size: number;
  label: string;
}) {
  return (
    <MascotPose
      variant={outfit?.rendering.variant ?? "cream"}
      pose={outfit?.rendering.pose ?? "basic"}
      size={size}
      label={label}
    />
  );
}

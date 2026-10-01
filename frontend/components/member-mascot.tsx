"use client";
import { getOutfit } from "@/lib/shop";
import type { MascotPoseProps } from "./mascot/MascotPose";
import { MascotPose } from "./mascot/MascotPose";
import { useApiResource } from "./use-api-resource";
export function MemberMascot(props: Omit<MascotPoseProps, "variant">) {
  const resource = useApiResource(getOutfit);
  if (!resource.data)
    return resource.error ? (
      <button type="button" className="text-button" onClick={resource.reload}>
        내 햄스터 다시 불러오기
      </button>
    ) : null;
  return <MascotPose {...props} variant={resource.data.rendering.variant} />;
}

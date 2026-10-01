"use client";
import { getOutfit } from "@/lib/shop";
import { useApiResource } from "./use-api-resource";
import { ProfileCharacter } from "./profile-character";
import { BreathingMascot } from "./mascot/BreathingMascot";
import { Loading } from "./ui";
export function MyCharacter() {
  const resource = useApiResource(getOutfit);
  return (
    <div className="my-character stack-sm">
      {resource.data ? (
        <>
          {resource.data.poseId === "pose.basic" &&
          !resource.data.clothingIds.length ? (
            <BreathingMascot
              variant={resource.data.rendering.variant}
              size={256}
              label="나의 대표 캐릭터"
            />
          ) : (
            <ProfileCharacter
              outfit={resource.data}
              size={256}
              label="나의 대표 캐릭터"
            />
          )}
        </>
      ) : resource.error ? (
        <button className="text-button" onClick={resource.reload}>
          내 캐릭터 다시 불러오기
        </button>
      ) : (
        <Loading />
      )}
    </div>
  );
}

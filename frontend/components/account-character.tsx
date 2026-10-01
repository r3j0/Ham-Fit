"use client";
import { getOutfit } from "@/lib/shop";
import { useApiResource } from "./use-api-resource";
import { ProfileCharacter } from "./profile-character";
import { Loading } from "./ui";

export function AccountCharacter() {
  const resource = useApiResource(getOutfit);
  if (!resource.data)
    return resource.error ? (
      <button className="text-button" onClick={resource.reload}>
        캐릭터 다시 확인
      </button>
    ) : (
      <Loading label="캐릭터를 불러오는 중이에요" />
    );
  const outfit = resource.data;
  return (
    <div className="profile-avatar">
      <ProfileCharacter
        outfit={outfit}
        size={199.68}
        label="나의 대표 캐릭터"
      />
    </div>
  );
}

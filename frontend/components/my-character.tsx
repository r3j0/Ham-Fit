"use client";
import { useMemberOutfit } from "./member-outfit-provider";
import { ProfileCharacter } from "./profile-character";
import { Loading } from "./ui";
export function MyCharacter() {
  const resource = useMemberOutfit();
  return (
    <div className="my-character stack-sm">
      {resource.data ? (
        <ProfileCharacter
          outfit={resource.data}
          size={256}
          label="나의 대표 캐릭터"
        />
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

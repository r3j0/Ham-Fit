"use client";
import { OutfitMascot, type OutfitMascotProps } from "./outfit-mascot";
import { useMemberOutfit } from "./member-outfit-provider";
export function MemberMascot(props: OutfitMascotProps) {
  const resource = useMemberOutfit();
  if (!resource.data)
    return resource.error ? (
      <button type="button" className="text-button" onClick={resource.reload}>
        내 햄스터 다시 불러오기
      </button>
    ) : null;
  return <OutfitMascot {...props} rendering={resource.data.rendering} />;
}

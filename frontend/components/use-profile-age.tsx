"use client";
import Link from "next/link";
import { ageOnDate } from "@/lib/birth-profile";
import { getBirthProfile } from "@/lib/workouts";
import { useApiResource } from "./use-api-resource";
import { Notice } from "./ui";

export function useProfileAge(measuredOn: string) {
  const resource = useApiResource(getBirthProfile);
  const birth = resource.data?.dateOfBirth;
  const age = birth ? ageOnDate(birth, measuredOn) : null;
  return {
    ...resource,
    age,
    available: !resource.loading && !resource.error && age !== null,
  };
}
export function ProfileAge({
  profile,
}: {
  profile: ReturnType<typeof useProfileAge>;
}) {
  if (profile.loading)
    return <p className="caption">프로필의 생년월일을 확인하고 있어요.</p>;
  if (profile.error)
    return (
      <Notice>
        생년월일을 불러오지 못했어요.{" "}
        <button type="button" className="text-button" onClick={profile.reload}>
          다시 불러오기
        </button>
      </Notice>
    );
  if (!profile.data?.dateOfBirth)
    return (
      <Notice>
        나이 계산을 위해 프로필에 생년월일을 등록해 주세요.{" "}
        <Link className="text-link" href="/account/settings?tab=birth">
          생년월일 등록
        </Link>
      </Notice>
    );
  if (profile.age === null)
    return <Notice>생년월일 이후의 올바른 측정일을 선택해 주세요.</Notice>;
  return (
    <p className="caption" aria-label="측정 당시 나이">
      측정일 기준 만 {profile.age}세 · 프로필 생년월일로 계산
    </p>
  );
}

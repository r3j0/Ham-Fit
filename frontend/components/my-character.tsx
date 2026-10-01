"use client";
import Link from "next/link";
import { useCallback } from "react";
import { getInventory, getOutfit } from "@/lib/shop";
import { useApiResource } from "./use-api-resource";
import { ProfileCharacter } from "./profile-character";
import { BreathingMascot } from "./mascot/BreathingMascot";
import { Loading } from "./ui";
export function MyCharacter() {
  const resource = useApiResource(
    useCallback(async (signal: AbortSignal) => {
      const [outfit, inventory] = await Promise.all([
        getOutfit(signal),
        getInventory(signal),
      ]);
      return { outfit, inventory };
    }, []),
  );
  return (
    <div className="my-character stack-sm">
      {resource.data ? (
        <>
          {resource.data.outfit.poseId === "pose.basic" &&
          !resource.data.outfit.clothingIds.length ? (
            <BreathingMascot
              variant={resource.data.outfit.rendering.variant}
              size={256}
              label="나의 대표 캐릭터"
            />
          ) : (
            <ProfileCharacter
              outfit={resource.data.outfit}
              size={256}
              label="나의 대표 캐릭터"
            />
          )}
          <Link href="/shop" className="shop-balance">
            🌻 해바라기씨 {resource.data.inventory.currency.balance}개
          </Link>
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

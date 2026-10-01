import Image from "next/image";
import type { MissionStage } from "@/lib/group-mission-contract";
import { SeedIcon } from "./seed-icon";
import sprout from "@/public/icons/mission-growth/sprout.png";
import stem from "@/public/icons/mission-growth/stem.png";
import bud from "@/public/icons/mission-growth/bud.png";
import sunflower from "@/public/icons/sunflower.png";

const images = { sprout, stem, bud, sunflower };
export const stageNames: Record<MissionStage, string> = {
  seed: "씨앗",
  sprout: "새싹",
  stem: "줄기",
  bud: "꽃봉오리",
  sunflower: "해바라기",
};

export function MissionGrowthImage({
  stage,
  size = 120,
  decorative = false,
}: {
  stage: MissionStage;
  size?: number;
  decorative?: boolean;
}) {
  if (stage === "seed")
    return (
      <SeedIcon
        height={Math.round(size * 0.85)}
        alt={decorative ? "" : "씨앗 단계"}
      />
    );
  return (
    <Image
      src={images[stage]}
      sizes={`${size}px`}
      loading="eager"
      alt={decorative ? "" : `${stageNames[stage]} 단계`}
      style={{ maxWidth: size, height: "auto", objectFit: "contain" }}
    />
  );
}

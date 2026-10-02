import type { MissionStage } from "@/lib/group-mission-contract";
import { MissionGrowthImage, stageNames } from "./mission-growth-image";
import styles from "./group-mission.module.css";

const plantSizes: Record<MissionStage, number> = {
  seed: 122,
  sprout: 152,
  stem: 174,
  bud: 182,
  sunflower: 154,
};

export function MissionGrowthScene({ stage }: { stage: MissionStage }) {
  return (
    <div className={styles.scene}>
      <span className={styles.sun} aria-hidden="true" />
      <span className={styles.cloudLeft} aria-hidden="true" />
      <span className={styles.cloudRight} aria-hidden="true" />
      <p className={styles.stageLabel}>
        {stage === "sunflower" ? "해바라기 완성!" : `${stageNames[stage]} 단계`}
      </p>
      <div className={styles.plantFrame}>
        {stage === "sunflower" && (
          <svg
            className={styles.flowerStem}
            viewBox="0 0 190 234"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M96 104C112 140 87 178 94 225"
              stroke="#44251c"
              strokeWidth="15"
              strokeLinecap="round"
            />
            <path
              d="M96 104C112 140 87 178 94 225"
              stroke="#76ae87"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M96 176C80 154 60 147 45 153C43 176 64 192 96 184Z"
              fill="#89bd98"
              stroke="#44251c"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <path
              d="M94 195C110 174 132 169 146 176C142 197 122 209 94 201Z"
              fill="#76ae87"
              stroke="#44251c"
              strokeWidth="5"
              strokeLinejoin="round"
            />
            <path
              d="M62 163L92 180M130 184L98 197"
              stroke="#56865f"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        )}
        <MissionGrowthImage stage={stage} size={plantSizes[stage]} />
      </div>
      <span className={styles.plantShadow} aria-hidden="true" />
    </div>
  );
}

import { createHash } from 'node:crypto';
import { FITNESS_FACTORS } from './workout-contracts.js';
import type { RecommendationVideo } from './workout-contracts.js';

export type RecommendationCatalog = {
  version: string;
  sourceCommit: string;
  sourceUrls: string[];
  checkedOn: string;
  contentHash: string;
  videos: RecommendationVideo[];
};
export const catalogHash = (videos: readonly RecommendationVideo[]) =>
  createHash('sha256').update(JSON.stringify(videos)).digest('hex');
export function validateCatalog(
  catalog: RecommendationCatalog,
): RecommendationCatalog {
  if (
    !catalog.version ||
    !catalog.sourceCommit ||
    !/^\d{4}-\d{2}-\d{2}$/.test(catalog.checkedOn) ||
    !catalog.videos.length
  )
    throw new Error('Catalog metadata or videos missing');
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const video of catalog.videos) {
    try {
      if (
        typeof video.videoId !== 'string' ||
        !/^[A-Za-z0-9_-]+\.mp4$/.test(video.videoId)
      )
        throw new Error(`${video.videoId}: invalid video ID`);
      if (ids.has(video.videoId))
        throw new Error(`${video.videoId}: duplicate ID`);
      ids.add(video.videoId);
      if (!video.title || !video.ageGroup)
        throw new Error(`${video.videoId}: title or ageGroup missing`);
      if (
        video.originalUrl !==
        `http://openapi.kspo.or.kr/web/video/${video.videoId}`
      )
        throw new Error(
          `${video.videoId}: URL does not match allowlisted source and ID`,
        );
      if (
        !Array.isArray(video.equipment) ||
        !video.equipment.every((e) => typeof e === 'string')
      )
        throw new Error(`${video.videoId}: equipment must be a string list`);
      if (!Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0)
        throw new Error(
          `${video.videoId}: durationSeconds must be finite and positive`,
        );
      // Validate only the BE numeric contract; normalization/scoring belongs to the data team.
      for (const factor of FITNESS_FACTORS) {
        const weight = video.fitnessWeights?.[factor];
        if (
          typeof weight !== 'number' ||
          !Number.isFinite(weight) ||
          weight < 0 ||
          weight > 1
        )
          throw new Error(
            `${video.videoId}: ${factor} must be a finite number in [0, 1]`,
          );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length)
    throw new Error(`Catalog activation blocked:\n${errors.join('\n')}`);
  if (catalog.contentHash !== catalogHash(catalog.videos))
    throw new Error('Catalog content hash mismatch');
  return catalog;
}

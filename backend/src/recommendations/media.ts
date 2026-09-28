import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const entrySchema = z.object({
  videoId: z.string(),
  originalUrl: z.string(),
  catalogDurationSeconds: z.number().positive(),
  status: z.enum(['verified', 'unavailable', 'duration_mismatch']),
  verifiedUrl: z.string().optional(),
  actualDurationSeconds: z.number().positive().optional(),
  httpsVerified: z.boolean().optional(),
  rangeSupported: z.boolean().optional(),
  mp4Validated: z.boolean().optional(),
  sourceContentTypes: z.array(z.string()),
});
const reportSchema = z.object({
  schemaVersion: z.literal(2),
  sourceCommit: z.string().min(1),
  durationToleranceSeconds: z.literal(1),
  videos: z.array(entrySchema),
});

/** Only a matching, structurally verified entry can enable its exact HTTPS URL. */
export function createMediaResolver(report: unknown, sourceCommit: string) {
  const parsed = reportSchema.safeParse(report);
  const entries =
    parsed.success && parsed.data.sourceCommit === sourceCommit
      ? parsed.data.videos
      : [];
  const indexed = new Map(entries.map((entry) => [entry.videoId, entry]));
  if (indexed.size !== entries.length) indexed.clear();
  return (videoId: string, originalUrl: string, durationSeconds: number) => {
    const entry = indexed.get(videoId);
    const expectedOriginal = `http://openapi.kspo.or.kr/web/video/${videoId}`;
    const expectedVerified = `https://openapi.kspo.or.kr/web/video/${videoId}`;
    const matches =
      /^[A-Za-z0-9_-]+\.mp4$/.test(videoId) &&
      originalUrl === expectedOriginal &&
      entry?.originalUrl === originalUrl &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0 &&
      entry.catalogDurationSeconds === durationSeconds;
    const evidence =
      matches &&
      entry.verifiedUrl === expectedVerified &&
      entry.httpsVerified === true &&
      entry.rangeSupported === true &&
      entry.mp4Validated === true &&
      Number.isFinite(entry.actualDurationSeconds) &&
      entry.actualDurationSeconds! > 0 &&
      entry.sourceContentTypes.length > 0 &&
      entry.sourceContentTypes.every((type) =>
        ['video/mp4', 'video/mg4'].includes(type),
      );
    const withinTolerance =
      evidence && Math.abs(entry.actualDurationSeconds! - durationSeconds) <= 1;
    const verified = evidence && entry.status === 'verified' && withinTolerance;
    const mismatch =
      evidence && entry.status === 'duration_mismatch' && !withinTolerance;
    return {
      playbackUrl: verified ? entry.verifiedUrl! : null,
      playbackStatus: verified
        ? 'verified'
        : mismatch
          ? 'duration_mismatch'
          : 'unavailable',
      verifiedDurationSeconds: evidence ? entry.actualDurationSeconds! : null,
    };
  };
}
const mediaReportPath = () =>
  resolve(
    process.env.WORKOUT_MEDIA_REPORT_PATH ||
      '.local/recommendation/media-verification.json',
  );
export function loadMediaResolver(
  sourceCommit: string,
  path = mediaReportPath(),
) {
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    /* Missing evidence is unavailable, never an assumed HTTPS success. */
  }
  return createMediaResolver(report, sourceCommit);
}
let cache:
  | {
      path: string;
      sourceCommit: string;
      resolver: ReturnType<typeof createMediaResolver>;
    }
  | undefined;
export function mediaFor(
  videoId: string,
  originalUrl: string,
  durationSeconds: number,
  sourceCommit: string,
) {
  // Resolve after Nest has loaded .env. Reloading an updated file requires restart.
  const path = mediaReportPath();
  if (cache?.path !== path || cache.sourceCommit !== sourceCommit)
    cache = {
      path,
      sourceCommit,
      resolver: loadMediaResolver(sourceCommit, path),
    };
  return cache.resolver(videoId, originalUrl, durationSeconds);
}

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaResolver, loadMediaResolver, mediaFor } from './media.js';
const SOURCE_COMMIT = 'test-fixture';
const id = 'TEST_A.mp4';
const original = `http://openapi.kspo.or.kr/web/video/${id}`;
const verified = `https://openapi.kspo.or.kr/web/video/${id}`;
const entry = {
  videoId: id,
  originalUrl: original,
  catalogDurationSeconds: 100,
  status: 'verified',
  verifiedUrl: verified,
  actualDurationSeconds: 100.4,
  httpsVerified: true,
  rangeSupported: true,
  mp4Validated: true,
  sourceContentTypes: ['video/mp4', 'video/mg4'],
};
const report = (patch: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  sourceCommit: SOURCE_COMMIT,
  durationToleranceSeconds: 1,
  videos: [{ ...entry, ...patch }],
});
describe('verified media selection', () => {
  it('works without checked-in reports and reads the configured runtime path lazily', () => {
    const directory = mkdtempSync(join(tmpdir(), 'health-media-test-'));
    const path = join(directory, 'report.json');
    try {
      expect(
        loadMediaResolver(SOURCE_COMMIT, path)(id, original, 100)
          .playbackStatus,
      ).toBe('unavailable');
      writeFileSync(path, 'invalid json');
      expect(
        loadMediaResolver(SOURCE_COMMIT, path)(id, original, 100)
          .playbackStatus,
      ).toBe('unavailable');
      writeFileSync(path, JSON.stringify(report()));
      vi.stubEnv('WORKOUT_MEDIA_REPORT_PATH', path);
      expect(mediaFor(id, original, 100, SOURCE_COMMIT).playbackUrl).toBe(
        verified,
      );
      expect(
        mediaFor(id, original, 100, 'another-catalog-source').playbackStatus,
      ).toBe('unavailable');
      expect(mediaFor(id, original, 100, SOURCE_COMMIT).playbackUrl).toBe(
        verified,
      );
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('enables only the exact independently verified HTTPS endpoint', () =>
    expect(
      createMediaResolver(report(), SOURCE_COMMIT)(id, original, 100),
    ).toEqual({
      playbackUrl: verified,
      playbackStatus: 'verified',
      verifiedDurationSeconds: 100.4,
    }));
  it('rejects changed source URL or catalog duration and unknown video IDs', () => {
    const resolve = createMediaResolver(report(), SOURCE_COMMIT);
    for (const result of [
      resolve(id, `${original}?changed=1`, 100),
      resolve(id, original, 101),
      resolve('OTHER.mp4', original, 100),
      resolve('../escape.mp4', original, 100),
    ])
      expect(result).toEqual({
        playbackUrl: null,
        playbackStatus: 'unavailable',
        verifiedDurationSeconds: null,
      });
  });
  it.each([
    undefined,
    {},
    null,
    { schemaVersion: 1, sourceCommit: SOURCE_COMMIT, videos: [entry] },
    { ...report(), sourceCommit: 'different' },
    { ...report(), videos: [entry, entry] },
  ])(
    'missing, old, wrong-version or duplicated evidence fails closed (%j)',
    (bad) =>
      expect(
        createMediaResolver(bad, SOURCE_COMMIT)(id, original, 100)
          .playbackStatus,
      ).toBe('unavailable'),
  );
  it.each([
    { mp4Validated: false },
    { rangeSupported: false },
    { httpsVerified: false },
    { verifiedUrl: 'https://attacker.invalid/video.mp4' },
    { sourceContentTypes: ['text/html'] },
    { actualDurationSeconds: undefined },
    { actualDurationSeconds: NaN },
    { actualDurationSeconds: Infinity },
    { actualDurationSeconds: 103 },
    { status: 'unavailable' },
  ])('does not substitute success for insufficient evidence (%j)', (patch) =>
    expect(
      createMediaResolver(report(patch), SOURCE_COMMIT)(id, original, 100)
        .playbackUrl,
    ).toBeNull(),
  );
  it('returns an explicit verified length mismatch without a playable replacement URL', () =>
    expect(
      createMediaResolver(
        report({ status: 'duration_mismatch', actualDurationSeconds: 104 }),
        SOURCE_COMMIT,
      )(id, original, 100),
    ).toEqual({
      playbackUrl: null,
      playbackStatus: 'duration_mismatch',
      verifiedDurationSeconds: 104,
    }));
});

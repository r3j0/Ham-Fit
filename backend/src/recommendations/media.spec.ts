import { describe, expect, it } from 'vitest';
import { createMediaResolver } from './media.js';
import { SOURCE_COMMIT } from './catalog.js';
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
  it('enables only the exact independently verified HTTPS endpoint', () =>
    expect(createMediaResolver(report())(id, original, 100)).toEqual({
      playbackUrl: verified,
      playbackStatus: 'verified',
      verifiedDurationSeconds: 100.4,
    }));
  it('rejects changed source URL or catalog duration and unknown video IDs', () => {
    const resolve = createMediaResolver(report());
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
      expect(createMediaResolver(bad)(id, original, 100).playbackStatus).toBe(
        'unavailable',
      ),
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
      createMediaResolver(report(patch))(id, original, 100).playbackUrl,
    ).toBeNull(),
  );
  it('returns an explicit verified length mismatch without a playable replacement URL', () =>
    expect(
      createMediaResolver(
        report({ status: 'duration_mismatch', actualDurationSeconds: 104 }),
      )(id, original, 100),
    ).toEqual({
      playbackUrl: null,
      playbackStatus: 'duration_mismatch',
      verifiedDurationSeconds: 104,
    }));
});

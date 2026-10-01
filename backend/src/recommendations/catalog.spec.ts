import { describe, expect, it } from 'vitest';
import { catalogHash, validateCatalog } from './catalog.js';
import { fixtureCatalog } from '../../test/fixtures/workouts.js';

describe('BE catalog persistence contract without a bundled data source', () => {
  it('accepts a supplied catalog without pinning a data commit or video count', () => {
    const catalog = fixtureCatalog();
    catalog.sourceCommit = 'future-data-revision';
    expect(validateCatalog(catalog)).toEqual(catalog);
  });
  it.each([NaN, Infinity, -0.1, 1.1])(
    'rejects invalid API numeric weight %s',
    (weight) => {
      const catalog = fixtureCatalog();
      catalog.videos[0].fitnessWeights.strength = weight;
      expect(() => validateCatalog(catalog)).toThrow('TEST_A.mp4');
    },
  );
  it('rejects duplicate IDs, invalid duration, source URLs and corrupted content hashes', () => {
    const duplicate = fixtureCatalog();
    duplicate.videos[1].videoId = duplicate.videos[0].videoId;
    expect(() => validateCatalog(duplicate)).toThrow('duplicate ID');
    const badDuration = fixtureCatalog();
    badDuration.videos[0].durationSeconds = 0;
    expect(() => validateCatalog(badDuration)).toThrow('durationSeconds');
    const badUrl = fixtureCatalog();
    badUrl.videos[0].originalUrl = 'https://example.test/untrusted.mp4';
    expect(() => validateCatalog(badUrl)).toThrow('URL');
    const corrupted = fixtureCatalog();
    corrupted.videos[0].title += '-changed';
    expect(() => validateCatalog(corrupted)).toThrow('hash mismatch');
    corrupted.contentHash = catalogHash(corrupted.videos);
    expect(validateCatalog(corrupted)).toEqual(corrupted);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  catalogHash,
  loadCatalog,
  parseEquipment,
  transformCatalog,
  validateCatalog,
} from './catalog.js';
import { FACTORS } from './engine.js';
const csvHeader = [
  'file_nm',
  'title',
  'file_url',
  'video_length',
  'age_group',
  ...FACTORS,
  'equipment',
];
describe('mandatory loader defect regressions', () => {
  it.each([
    { name: 'zero-sum weights', values: [0, 0, 0, 0, 0, 0], sum: 0 },
    { name: 'sum 1.4 weights', values: [0.7, 0.7, 0, 0, 0, 0], sum: 1.4 },
  ])(
    'rejects $name with ID and reason through actual import path',
    ({ values, sum }) => {
      const csv = `${csvHeader.join(',')}\ninvalid.mp4,Invalid,http://openapi.kspo.or.kr/web/video/invalid.mp4,60,공통,${values.join(',')},[]\n`;
      const json = [
        {
          videoId: 'invalid.mp4',
          title: 'Invalid',
          videoUrl: 'http://openapi.kspo.or.kr/web/video/invalid.mp4',
          ageGroup: '공통',
          equipment: [],
          fitnessWeights: Object.fromEntries(
            FACTORS.map((f, i) => [f, values[i]]),
          ),
        },
      ];
      expect(() => transformCatalog(csv, json)).toThrow(
        `invalid.mp4: weight sum ${sum} must equal 1`,
      );
    },
  );
  it('imports all actual 731 rows, matching JSON to CSV durations', () => {
    const base = 'data/recommendation/source/data-analysis/data/processed/';
    const catalog = transformCatalog(
      readFileSync(`${base}workout_videos.csv`, 'utf8'),
      JSON.parse(readFileSync(`${base}workout_videos.json`, 'utf8')),
    );
    expect(catalog.videos).toHaveLength(731);
    expect(Math.min(...catalog.videos.map((v) => v.durationSeconds))).toBe(32);
    expect(Math.max(...catalog.videos.map((v) => v.durationSeconds))).toBe(
      2928,
    );
    expect(catalog.videos.filter((v) => v.durationSeconds >= 600)).toHaveLength(
      19,
    );
  });
});

describe('catalog activation safeguards', () => {
  it.each([NaN, Infinity, -0.1, 1.1])(
    'rejects invalid numeric weight %s with ID',
    (weight) => {
      const catalog = structuredClone(loadCatalog());
      catalog.videos[0].fitnessWeights.strength = weight;
      expect(() => validateCatalog(catalog)).toThrow(catalog.videos[0].videoId);
    },
  );
  it('rejects a missing factor, duplicate ID, corrupted hash and truncated pinned catalog', () => {
    const catalog = structuredClone(loadCatalog());
    delete (
      catalog.videos[0].fitnessWeights as Partial<
        (typeof catalog.videos)[0]['fitnessWeights']
      >
    ).power;
    expect(() => validateCatalog(catalog)).toThrow('power must be finite');
    const duplicate = structuredClone(loadCatalog());
    duplicate.videos[1].videoId = duplicate.videos[0].videoId;
    expect(() => validateCatalog(duplicate)).toThrow('duplicate ID');
    const corrupted = structuredClone(loadCatalog());
    corrupted.videos[0].title += 'changed';
    expect(() => validateCatalog(corrupted)).toThrow('hash mismatch');
    const truncated = structuredClone(loadCatalog());
    truncated.videos.pop();
    truncated.contentHash = catalogHash(truncated.videos);
    expect(() => validateCatalog(truncated)).toThrow('731');
  });
  it('parses literal equipment data only and preserves unknown empty equipment', () => {
    expect(parseEquipment('[]', 'safe.mp4')).toEqual([]);
    expect(parseEquipment("['매트', '짐볼']", 'safe.mp4')).toEqual([
      '매트',
      '짐볼',
    ]);
    expect(() =>
      parseEquipment("[__import__('os').system('exit')]", 'bad.mp4'),
    ).toThrow('bad.mp4');
  });
  it('rejects mismatched CSV/JSON, invalid CSV columns and duplicate JSON IDs', () => {
    const base = 'data/recommendation/source/data-analysis/data/processed/';
    const csv = readFileSync(`${base}workout_videos.csv`, 'utf8');
    const json = JSON.parse(
      readFileSync(`${base}workout_videos.json`, 'utf8'),
    ) as { videoId: string; title: string }[];
    const duplicate = [...json, json[0]];
    expect(() => transformCatalog(csv, duplicate)).toThrow('duplicate JSON ID');
    json[0].title += 'changed';
    expect(() => transformCatalog(csv, json)).toThrow(
      `${json[0].videoId}: CSV/JSON metadata differ`,
    );
    expect(() =>
      transformCatalog(csv.replace(',power,', ',not_power,'), json),
    ).toThrow('missing column power');
  });
});

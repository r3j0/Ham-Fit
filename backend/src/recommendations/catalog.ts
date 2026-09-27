import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FACTORS, validateWeights } from './engine.js';
import type { RecommendationVideo } from './engine.js';

export const CATALOG_VERSION = 'nfa100-videos-92f3493-v1';
export const SOURCE_COMMIT = '92f3493de704c644d5aeff353488f1aff49f1836';
export const PINNED_CATALOG_HASH =
  '1be888bb7a10fcb4740b4eb8dbcb2c6ea0a956d7725d14cc8241ff03946a72d2';
export const SOURCE_URLS = [
  'https://app.notion.com/p/3e5634ca4bdf80bebc0cfac2f1721251',
  'https://app.notion.com/p/3e5634ca4bdf80c388fdcfcd9b624204',
  'http://openapi.kspo.or.kr/web/video/',
];
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
      validateWeights(video.fitnessWeights, video.videoId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length)
    throw new Error(`Catalog activation blocked:\n${errors.join('\n')}`);
  if (catalog.contentHash !== catalogHash(catalog.videos))
    throw new Error('Catalog content hash mismatch');
  if (
    catalog.version === CATALOG_VERSION &&
    (catalog.sourceCommit !== SOURCE_COMMIT ||
      catalog.videos.length !== 731 ||
      catalog.contentHash !== PINNED_CATALOG_HASH)
  ) {
    throw new Error(
      'Pinned catalog version requires all 731 unmodified source definitions',
    );
  }
  return catalog;
}
/** RFC4180 parser; equipment is parsed separately as a limited list grammar, never eval. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if (char === '\n' && !quoted) {
      row.push(value.replace(/\r$/, ''));
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers || new Set(headers).size !== headers.length)
    throw new Error('CSV headers are missing or duplicated');
  const required = [
    'file_nm',
    'title',
    'file_url',
    'video_length',
    'age_group',
    'equipment',
    ...FACTORS,
  ];
  for (const field of required)
    if (!headers.includes(field))
      throw new Error(`CSV missing column ${field}`);
  return rows.map((fields, index) => {
    if (fields.length !== headers.length)
      throw new Error(`CSV row ${index + 2}: column count mismatch`);
    return Object.fromEntries(headers.map((header, i) => [header, fields[i]]));
  });
}
export function parseEquipment(source: string, id: string): string[] {
  // Source format is Python single-quoted string lists. Permit only this data grammar.
  if (
    !/^\[\s*(?:'(?:[^'\\]|\\['\\])*'\s*(?:,\s*'(?:[^'\\]|\\['\\])*'\s*)*)?\]$/.test(
      source,
    )
  )
    throw new Error(`${id}: invalid equipment list`);
  return [...source.matchAll(/'((?:[^'\\]|\\['\\])*)'/g)].map((match) =>
    match[1].replace(/\\(['\\])/g, '$1'),
  );
}
export function transformCatalog(
  csv: string,
  json: unknown,
): RecommendationCatalog {
  if (!Array.isArray(json)) throw new Error('Source JSON must be an array');
  const indexed = new Map<string, Record<string, unknown>>();
  for (const row of json as Record<string, unknown>[]) {
    if (typeof row.videoId !== 'string' || indexed.has(row.videoId))
      throw new Error(`${String(row.videoId)}: missing or duplicate JSON ID`);
    indexed.set(row.videoId, row);
  }
  const videos = parseCsv(csv).map((row) => {
    const id = row.file_nm;
    const j = indexed.get(id);
    if (!j) throw new Error(`${id}: CSV row has no JSON match`);
    const equipment = parseEquipment(row.equipment, id);
    const weights = Object.fromEntries(
      FACTORS.map((f) => [
        f,
        row[f].trim() === '' ? Number.NaN : Number(row[f]),
      ]),
    );
    const fitnessWeights = validateWeights(weights, id);
    const jsonWeights = j.fitnessWeights as Record<string, unknown> | undefined;
    if (
      !jsonWeights ||
      FACTORS.some(
        (f) =>
          typeof (jsonWeights[f] ?? 0) !== 'number' ||
          Math.abs(Number(jsonWeights[f] ?? 0) - fitnessWeights[f]) > 1e-12,
      )
    )
      throw new Error(`${id}: CSV/JSON weights differ`);
    if (
      j.title !== row.title ||
      j.videoUrl !== row.file_url ||
      j.ageGroup !== row.age_group ||
      JSON.stringify(j.equipment) !== JSON.stringify(equipment)
    )
      throw new Error(`${id}: CSV/JSON metadata differ`);
    return {
      videoId: id,
      title: row.title,
      originalUrl: row.file_url,
      ageGroup: row.age_group,
      equipment,
      fitnessWeights,
      durationSeconds: Number(row.video_length),
    };
  });
  if (videos.length !== indexed.size)
    throw new Error('CSV/JSON ID sets differ');
  return validateCatalog({
    version: CATALOG_VERSION,
    sourceCommit: SOURCE_COMMIT,
    sourceUrls: SOURCE_URLS,
    checkedOn: '2026-09-27',
    contentHash: catalogHash(videos),
    videos,
  });
}
export function loadCatalog(
  path = resolve(process.cwd(), 'data/recommendation/catalog.json'),
): RecommendationCatalog {
  return validateCatalog(
    JSON.parse(readFileSync(path, 'utf8')) as RecommendationCatalog,
  );
}

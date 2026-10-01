import { placementKey, placementSource, targetLayer } from './placements';
import type { PlacementTarget } from './placements';
import type { HamsterItem, ItemCatalog } from './types';
import { POSES } from './poses';

export interface ArtworkEntry extends PlacementTarget {
  source: string;
  originalSrc: string;
  originalSha256: string;
  src: string;
  sha256: string;
  editedAt: string;
}
export interface ArtworkDocument { schemaVersion: 1; entries: ArtworkEntry[] }
export interface ArtworkStore { document: ArtworkDocument; revision: string }
export const EMPTY_ARTWORK: ArtworkDocument = { schemaVersion: 1, entries: [] };
export const artworkUrl = (hash: string) => `/hamsters/edits/${hash}.png`;
const hashPattern = /^[a-f0-9]{64}$/;

export function parseArtworkDocument(value: unknown): ArtworkDocument {
  const document = value as ArtworkDocument | null;
  if (document?.schemaVersion !== 1 || !Array.isArray(document.entries) || document.entries.length > 20000) throw new Error('의상 수정 파일의 형식이 올바르지 않습니다.');
  const keys = new Set<string>();
  for (const entry of document.entries) {
    if (!entry || typeof entry.itemId !== 'string' || !Object.hasOwn(POSES, entry.pose) || !['cream', 'gray', 'shared'].includes(entry.variant) ||
        !['layers', 'foreground'].includes(entry.group) || !Number.isInteger(entry.index) || entry.index < 0 ||
        typeof entry.source !== 'string' || !/^\/hamsters\/wardrobe\/[a-zA-Z0-9_/-]+\.png$/.test(entry.originalSrc) ||
        !hashPattern.test(entry.originalSha256) || !hashPattern.test(entry.sha256) || entry.src !== artworkUrl(entry.sha256) ||
        !Number.isFinite(Date.parse(entry.editedAt)) || keys.has(placementKey(entry))) throw new Error('의상 수정 파일에 유효하지 않은 레이어가 있습니다.');
    keys.add(placementKey(entry));
  }
  return document;
}
export function matchingArtwork(catalog: ItemCatalog, document: ArtworkDocument, target: PlacementTarget) {
  const original = targetLayer(catalog, target);
  const entry = document.entries.find(entry => placementKey(entry) === placementKey(target));
  return original && entry && entry.originalSrc === original.layer.src && entry.source === placementSource(original.layer, original.frame) ? entry : undefined;
}
type PaintedCatalog<C extends ItemCatalog> = { [K in keyof C]: Omit<C[K], 'poses'> & Pick<HamsterItem, 'poses'> };
/** Artwork changes only image URLs. Apply placement overrides first, using the original catalog for signatures. */
export function applyArtwork<C extends ItemCatalog>(catalog: C, document: ArtworkDocument, originals: ItemCatalog = catalog): PaintedCatalog<C> {
  const result: Record<string, HamsterItem> = { ...catalog };
  for (const entry of document.entries) {
    const original = targetLayer(originals, entry);
    if (!original || entry.originalSrc !== original.layer.src || entry.source !== placementSource(original.layer, original.frame)) continue;
    const item = result[entry.itemId];
    const variants = item.poses[entry.pose]!;
    const frame = variants[entry.variant]!;
    const layers = [...frame[entry.group]!];
    layers[entry.index] = { ...layers[entry.index], src: entry.src };
    result[entry.itemId] = { ...item, poses: { ...item.poses, [entry.pose]: { ...variants, [entry.variant]: { ...frame, [entry.group]: layers } } } };
  }
  return result as PaintedCatalog<C>;
}

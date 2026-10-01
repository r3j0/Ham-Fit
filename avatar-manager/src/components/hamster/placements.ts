import { POSES } from './poses';
import type { HamsterItem, HamsterPose, HamsterVariant, ItemCatalog, LayerAsset, PoseLayers } from './types';

export interface LayerPlacement { x: number; y: number; width: number; height: number; rotation: number }
export interface PlacementTarget {
  itemId: string;
  pose: HamsterPose;
  variant: HamsterVariant | 'shared';
  group: 'layers' | 'foreground';
  index: number;
}
export interface PlacementChange extends PlacementTarget {
  source: string;
  placement: LayerPlacement | null;
}
export interface PlacementDocument { schemaVersion: 1; entries: PlacementChange[] }
export const EMPTY_PLACEMENTS: PlacementDocument = { schemaVersion: 1, entries: [] };
export const PLACEMENT_LIMITS = {
  x: [-2000, 2000], y: [-2000, 2000], width: [1, 4000], height: [1, 4000], rotation: [-180, 180],
} as const;

export function layerPlacement(layer: LayerAsset): LayerPlacement {
  return { x: layer.x ?? 0, y: layer.y ?? 0, width: layer.width ?? 1000, height: layer.height ?? 1000, rotation: layer.rotation ?? 0 };
}
export function placementKey(target: PlacementTarget) {
  return JSON.stringify([target.itemId, target.pose, target.variant, target.group, target.index]);
}
export function registeredFrame(item: HamsterItem | undefined, pose: HamsterPose, variant: HamsterVariant) {
  const variants = item?.poses[pose];
  const registration: HamsterVariant | 'shared' = variants?.[variant] ? variant : 'shared';
  return { frame: variants?.[registration], registration };
}
export function targetLayer(catalog: ItemCatalog, target: PlacementTarget) {
  if (!target || typeof target.itemId !== 'string' || !Object.hasOwn(catalog, target.itemId) ||
      !Object.hasOwn(POSES, target.pose) || !['cream', 'gray', 'shared'].includes(target.variant) ||
      !['layers', 'foreground'].includes(target.group) || !Number.isInteger(target.index) || target.index < 0) return;
  const frame = catalog[target.itemId].poses[target.pose]?.[target.variant];
  const layer = frame?.[target.group]?.[target.index];
  return layer && { layer, frame };
}
/** Invalidate old adjustments when an import changes the layer or its review revision. */
export function placementSource(layer: LayerAsset, frame: PoseLayers) {
  return JSON.stringify([layer.src, layerPlacement(layer), layer.zIndex, layer.opacity ?? 1, frame.qa?.reviewedAt ?? null, layer.fit ?? 'contain']);
}
export function validatePlacement(value: unknown): value is LayerPlacement {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Object.entries(PLACEMENT_LIMITS).every(([key, [min, max]]) =>
    typeof candidate[key] === 'number' && Number.isFinite(candidate[key]) && candidate[key] >= min && candidate[key] <= max) &&
    Object.keys(candidate).length === 5;
}
export function parsePlacementDocument(value: unknown): PlacementDocument {
  const document = value as PlacementDocument | null;
  if (document?.schemaVersion !== 1 || !Array.isArray(document.entries) || document.entries.length > 20000) {
    throw new Error('의상 조정 파일의 형식이 올바르지 않습니다.');
  }
  const keys = new Set<string>();
  for (const entry of document.entries) {
    if (!entry || typeof entry.itemId !== 'string' || !Object.hasOwn(POSES, entry.pose) ||
        !['cream', 'gray', 'shared'].includes(entry.variant) || !['layers', 'foreground'].includes(entry.group) ||
        !Number.isInteger(entry.index) || entry.index < 0 || typeof entry.source !== 'string' ||
        !validatePlacement(entry.placement) || keys.has(placementKey(entry))) {
      throw new Error('의상 조정 파일에 유효하지 않거나 중복된 레이어가 있습니다.');
    }
    keys.add(placementKey(entry));
  }
  return document;
}
export function mergePlacementChanges(catalog: ItemCatalog, document: PlacementDocument, changes: readonly PlacementChange[]): PlacementDocument {
  const entries = new Map(document.entries.map(entry => [placementKey(entry), entry]));
  const seen = new Set<string>();
  for (const change of changes) {
    const target = targetLayer(catalog, change);
    if (!target || change.source !== placementSource(target.layer, target.frame)) {
      throw new Error('의상이 변경되었거나 없는 레이어입니다. 페이지를 새로고침해 주세요.');
    }
    if (change.placement !== null && !validatePlacement(change.placement)) {
      throw new Error('위치·크기·회전 값이 허용 범위를 벗어났습니다.');
    }
    const key = placementKey(change);
    if (seen.has(key)) throw new Error('같은 레이어를 중복 저장할 수 없습니다.');
    seen.add(key);
    if (change.placement === null) entries.delete(key);
    else entries.set(key, {
      itemId: change.itemId, pose: change.pose, variant: change.variant, group: change.group,
      index: change.index, source: change.source, placement: { ...change.placement },
    });
  }
  return parsePlacementDocument({ schemaVersion: 1, entries: [...entries.values()].sort((a, b) => placementKey(a).localeCompare(placementKey(b))) });
}
type PlacedCatalog<C extends ItemCatalog> = { [K in keyof C]: Omit<C[K], 'poses'> & Pick<HamsterItem, 'poses'> };
/** Pure copy-on-write: the original catalog, QA, base images and layer order stay intact. */
export function applyPlacements<C extends ItemCatalog>(catalog: C, document: PlacementDocument): PlacedCatalog<C> {
  const result: Record<string, HamsterItem> = { ...catalog };
  for (const entry of document.entries) {
    const target = targetLayer(catalog, entry);
    if (!target || !validatePlacement(entry.placement) || entry.source !== placementSource(target.layer, target.frame)) continue;
    const item = result[entry.itemId];
    const variants = item.poses[entry.pose]!;
    const frame = variants[entry.variant]!;
    const layers = [...frame[entry.group]!];
    const original = layerPlacement(target.layer);
    const stretched = Math.abs(entry.placement.width / entry.placement.height - original.width / original.height) > 0.00001;
    layers[entry.index] = { ...layers[entry.index], ...entry.placement, ...(stretched ? { fit: 'stretch' as const } : {}) };
    result[entry.itemId] = { ...item, poses: { ...item.poses, [entry.pose]: { ...variants, [entry.variant]: { ...frame, [entry.group]: layers } } } };
  }
  return result as PlacedCatalog<C>;
}

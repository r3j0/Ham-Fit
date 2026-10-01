import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backendBase, backendRequest } from './backend';
import { readSourceCatalog } from './source-catalog';
import { readWardrobeStore } from './wardrobe-store';
import { readArtworkStore } from './artwork-store';
import { applyPlacements, layerPlacement, placementSource } from '../components/hamster/placements';
import { applyArtwork } from '../components/hamster/artwork';
import type { PlacementChange, PlacementTarget } from '../components/hamster/placements';
import type { ArtworkEntry } from '../components/hamster/artwork';
import type { ItemCatalog, LayerAsset, HamsterPose, HamsterVariant, PoseLayers } from '../components/hamster/types';

export function catalogLayers(catalog: ItemCatalog, visit: (layer: LayerAsset, target: PlacementTarget, frame: PoseLayers) => void) {
  for (const [itemId, item] of Object.entries(catalog)) for (const [pose, variants] of Object.entries(item.poses)) for (const [variant, frame] of Object.entries(variants ?? {})) {
    for (const group of ['layers', 'foreground'] as const) frame?.[group]?.forEach((layer, index) => visit(layer, { itemId, pose: pose as HamsterPose, variant: variant as HamsterVariant | 'shared', group, index }, frame));
  }
}
export async function publishDraft(input: { revision: number; products: unknown[]; combinations: unknown[]; reviewed: boolean; placementRevision: string; artworkRevision: string }) {
  const [placements, artwork, sourceCatalog] = await Promise.all([readWardrobeStore(), readArtworkStore(), readSourceCatalog()]);
  if (input.placementRevision !== placements.revision || input.artworkRevision !== artwork.revision) throw new Error('로컬 편집 내용이 다른 창에서 변경되었습니다. 새로고침 후 확인하세요.');
  const catalog = applyArtwork(applyPlacements(sourceCatalog, placements.document), artwork.document, sourceCatalog);
  const uploads = new Map<string, string>();
  const originals = structuredClone(sourceCatalog), published = structuredClone(catalog);
  const urls = new Set<string>();
  for (const value of [originals, published]) catalogLayers(value, layer => urls.add(layer.src));
  const root = await realpath(path.join(process.cwd(), 'public/hamsters'));
  for (const src of urls) {
    if (!src.startsWith('/hamsters/')) throw new Error('로컬 의상 PNG만 등록할 수 있습니다.');
    const file = await realpath(path.join(process.cwd(), 'public', src));
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('이미지 경로가 저장 폴더를 벗어납니다.');
    const bytes = await readFile(file);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('PNG는 8 MiB 이하여야 합니다.');
    const form = new FormData(); form.append('png', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'wardrobe.png');
    const uploaded = await backendRequest('/avatar-manager/images', { method: 'POST', body: form });
    uploads.set(src, uploaded.src);
  }
  for (const value of [originals, published]) catalogLayers(value, layer => { layer.src = uploads.get(layer.src)!; });
  const metadata = { revision: input.revision, products: input.products, combinations: input.combinations, reviewed: input.reviewed, sourceCatalog: originals, catalog: published };
  const form = new FormData(); form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'catalog.json');
  return backendRequest('/avatar-manager/publish', { method: 'POST', body: form });
}
export async function pullCatalog() {
  const server = await backendRequest('/avatar-manager/catalog');
  if (!Object.keys(server.catalog).length) throw new Error('서버에 등록한 의상이 없습니다. 로컬 의상을 먼저 편집해 등록하세요.');
  const originals = structuredClone(server.sourceCatalog) as ItemCatalog;
  const catalog = server.catalog as ItemCatalog;
  const placementEntries: PlacementChange[] = [], artworkEntries: ArtworkEntry[] = [];
  const root = process.cwd();
  await mkdir(path.join(root, 'public/hamsters/wardrobe/server'), { recursive: true });
  await mkdir(path.join(root, 'public/hamsters/edits'), { recursive: true });
  const downloaded = new Map<string, Buffer>();
  const download = async (src: string) => {
    const hash = /^\/api\/v1\/avatar\/assets\/([a-f0-9]{64})\.png$/.exec(src)?.[1];
    if (!hash) throw new Error('서버 이미지 경로가 올바르지 않습니다.');
    if (!downloaded.has(hash)) {
      const response = await fetch(`${new URL(backendBase()).origin}${src}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('서버 PNG를 불러오지 못했습니다.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('서버 이미지 해시가 일치하지 않습니다.');
      downloaded.set(hash, bytes);
    }
    return { hash, bytes: downloaded.get(hash)! };
  };
  const jobs: { layer: LayerAsset; target: PlacementTarget; frame: PoseLayers; originalSrc: string }[] = [];
  catalogLayers(originals, (layer, target, frame) => jobs.push({ layer, target, frame, originalSrc: layer.src }));
  for (const { layer, target, frame, originalSrc } of jobs) {
    const original = await download(originalSrc);
    layer.src = `/hamsters/wardrobe/server/${original.hash}.png`;
    await writeFile(path.join(root, 'public', layer.src), original.bytes);
    const next = catalog[target.itemId].poses[target.pose]![target.variant]![target.group]![target.index];
    const placement = layerPlacement(next);
    if (JSON.stringify(placement) !== JSON.stringify(layerPlacement(layer))) placementEntries.push({ ...target, source: placementSource(layer, frame), placement });
    if (next.src !== originalSrc) {
      const edited = await download(next.src);
      await writeFile(path.join(root, 'public/hamsters/edits', `${edited.hash}.png`), edited.bytes);
      artworkEntries.push({ ...target, source: placementSource(layer, frame), originalSrc: layer.src, originalSha256: original.hash, src: `/hamsters/edits/${edited.hash}.png`, sha256: edited.hash, editedAt: new Date().toISOString() });
    }
  }
  await mkdir(path.join(root, '.local/backups'), { recursive: true });
  const backup = path.join(root, '.local/backups', String(Date.now())); await mkdir(backup);
  for (const name of ['catalog.json', 'placements.json', 'artwork.json']) {
    try { await writeFile(path.join(backup, name), await readFile(path.join(root, '.local', name))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await writeFile(path.join(root, '.local/catalog.json'), JSON.stringify(originals));
  await writeFile(path.join(root, '.local/placements.json'), JSON.stringify({ schemaVersion: 1, entries: placementEntries }));
  await writeFile(path.join(root, '.local/artwork.json'), JSON.stringify({ schemaVersion: 1, entries: artworkEntries }));
  return { revision: server.revision, layers: jobs.length };
}

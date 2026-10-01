import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { backendRequest } from './backend';
import { catalogLayers, prepareFrontendAssets, readFrontendImage, readFrontendCatalog, verifyFrontendDeployment } from './frontend-assets';
import { layerPlacement, placementSource } from '../components/hamster/placements';
import type { PlacementChange, PlacementTarget } from '../components/hamster/placements';
import type { ArtworkEntry } from '../components/hamster/artwork';
import type { ItemCatalog, LayerAsset, PoseLayers } from '../components/hamster/types';
export { catalogLayers } from './frontend-assets';

export async function publishDraft(input: { revision: number; products: unknown[]; combinations: unknown[]; reviewed: boolean; placementRevision: string; artworkRevision: string }) {
  if (input.reviewed !== true) throw new Error('상품과 착용 조합을 검수하세요.');
  const prepared = await prepareFrontendAssets(input);
  // One static manifest request, never a PNG request or an image upload.
  await verifyFrontendDeployment(prepared.bundle);
  const settings = input.products as { renderKey: string; price: number; saleStatus: string }[];
  if (settings.length !== Object.keys(prepared.published).length || new Set(settings.map(p => p.renderKey)).size !== settings.length || settings.some(p => !prepared.published[p.renderKey])) throw new Error('모든 상품의 ID와 가격이 필요합니다.');
  const products = settings.map(product => {
    const item = prepared.published[product.renderKey];
    const frames = Object.entries(item.poses).flatMap(([pose, variants]) => (['cream', 'gray'] as const).filter(variant => variants?.[variant] || variants?.shared).map(variant => ({ pose, variant })));
    return { ...product, slot: item.slot, frames };
  });
  const metadata = { revision: input.revision, products, combinations: input.combinations, reviewed: input.reviewed };
  const form = new FormData(); form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'catalog.json');
  return backendRequest('/avatar-manager/publish', { method: 'POST', body: form }, 60000, 2);
}
export async function pullCatalog() {
  const originals = structuredClone(await readFrontendCatalog(true));
  const catalog = await readFrontendCatalog();
  if (!Object.keys(catalog).length) throw new Error('프론트엔드에 내보낸 의상이 없습니다.');
  const placementEntries: PlacementChange[] = [], artworkEntries: ArtworkEntry[] = [];
  const root = process.cwd();
  await mkdir(path.join(root, 'public/hamsters/wardrobe/server'), { recursive: true });
  await mkdir(path.join(root, 'public/hamsters/edits'), { recursive: true });
  const downloaded = new Map<string, { hash: string; bytes: Buffer }>();
  const download = async (src: string) => {
    if (!downloaded.has(src)) downloaded.set(src, await readFrontendImage(src));
    return downloaded.get(src)!;
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
  return { layers: jobs.length };
}

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readSourceCatalog } from './source-catalog';
import { artworkUrl, EMPTY_ARTWORK, matchingArtwork, parseArtworkDocument } from '../components/hamster/artwork';
import type { ArtworkDocument, ArtworkEntry } from '../components/hamster/artwork';
import { placementKey, placementSource, targetLayer } from '../components/hamster/placements';
import type { PlacementTarget } from '../components/hamster/placements';
import type { ItemCatalog } from '../components/hamster/types';
import { WardrobeStoreError } from './wardrobe-errors';

export const ARTWORK_FILE = '.local/artwork.json';
export const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const revisionOf = (document: ArtworkDocument) => sha(JSON.stringify(document));
export async function readArtworkStore(root = process.cwd()) {
  let document: ArtworkDocument;
  try { document = parseArtworkDocument(JSON.parse(await readFile(path.join(root, ARTWORK_FILE), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    document = { ...EMPTY_ARTWORK, entries: [] };
  }
  return { document, revision: revisionOf(document) };
}
async function originalArtwork(target: PlacementTarget, root: string, catalog: ItemCatalog) {
  const original = targetLayer(catalog, target);
  if (!original || !/^\/hamsters\/wardrobe\/[a-zA-Z0-9_/-]+\.png$/.test(original.layer.src)) throw new WardrobeStoreError('수정할 수 있는 의상 PNG 레이어가 아닙니다.', 400);
  const sourceRoot = await realpath(path.join(root, 'public/hamsters/wardrobe'));
  const file = await realpath(path.join(root, 'public', original.layer.src.slice(1)));
  if (!file.startsWith(sourceRoot + path.sep)) throw new WardrobeStoreError('의상 파일 경로가 올바르지 않습니다.', 400);
  const bytes = await readFile(file);
  return { original, originalSha256: sha(bytes), source: placementSource(original.layer, original.frame) };
}
export async function readArtworkContext(target: PlacementTarget, root = process.cwd(), catalog?: ItemCatalog) {
  catalog ??= await readSourceCatalog(root);
  const [{ original, originalSha256, source }, store] = await Promise.all([originalArtwork(target, root, catalog), readArtworkStore(root)]);
  const entry = matchingArtwork(catalog, store.document, target);
  return { ...store, source, originalSha256, originalSrc: original.layer.src,
    src: entry?.originalSha256 === originalSha256 ? entry.src : original.layer.src };
}
export async function decodeArtworkPng(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_ARTWORK_BYTES) throw new WardrobeStoreError('PNG 크기는 8MB 이하여야 합니다.', 400);
  try {
    const image = sharp(bytes, { limitInputPixels: 1_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== 'png' || metadata.width !== 1000 || metadata.height !== 1000 || (metadata.pages ?? 1) !== 1) throw new Error('PNG dimensions');
    // Fully erased artwork is valid: keep transparent pixels rather than resurrecting the source garment.
    return await image.ensureAlpha().png().toBuffer();
  } catch { throw new WardrobeStoreError('손상되지 않은 1000×1000 PNG만 저장할 수 있습니다.', 400); }
}
export async function saveArtwork(target: PlacementTarget, source: string, originalSha256: string, revision: string, bytes: Buffer | null, root = process.cwd(), catalog?: ItemCatalog) {
  catalog ??= await readSourceCatalog(root);
  await mkdir(path.join(root, '.local'), { recursive: true });
  const file = path.join(root, ARTWORK_FILE);
  let lock;
  try { lock = await open(`${file}.lock`, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WardrobeStoreError('다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.', 409);
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  let imageTemporary: string | undefined;
  try {
    const [current, context] = await Promise.all([readArtworkStore(root), originalArtwork(target, root, catalog)]);
    if (current.revision !== revision) throw new WardrobeStoreError('다른 창에서 의상을 수정했습니다. 세부 작업을 닫고 다시 열어 주세요.', 409);
    if (context.source !== source || context.originalSha256 !== originalSha256) throw new WardrobeStoreError('원본 의상이 변경되었습니다. 세부 작업을 닫고 다시 열어 주세요.', 409);
    const entries = current.document.entries.filter(entry => placementKey(entry) !== placementKey(target));
    let entry: ArtworkEntry | undefined;
    if (bytes !== null) {
      const png = await decodeArtworkPng(bytes);
      const hash = sha(png);
      const destination = path.join(root, 'public/hamsters/edits', `${hash}.png`);
      await mkdir(path.dirname(destination), { recursive: true });
      imageTemporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(imageTemporary, png);
      await rename(imageTemporary, destination);
      entry = { itemId: target.itemId, pose: target.pose, variant: target.variant, group: target.group, index: target.index,
        source, originalSrc: context.original.layer.src, originalSha256, src: artworkUrl(hash), sha256: hash, editedAt: new Date().toISOString() };
      entries.push(entry);
    }
    const document = parseArtworkDocument({ schemaVersion: 1, entries: entries.sort((a, b) => placementKey(a).localeCompare(placementKey(b))) });
    await writeFile(temporary, JSON.stringify(document, null, 2) + '\n', 'utf8');
    await rename(temporary, file);
    return { document, revision: revisionOf(document), src: entry?.src ?? context.original.layer.src };
  } finally {
    await unlink(temporary).catch(() => {});
    if (imageTemporary) await unlink(imageTemporary).catch(() => {});
    await lock.close(); await unlink(`${file}.lock`);
  }
}
export async function readEditedPng(filename: string, root = process.cwd()) {
  if (!/^[a-f0-9]{64}\.png$/.test(filename)) throw new WardrobeStoreError('의상 수정 파일을 찾을 수 없습니다.', 404);
  const bytes = await readFile(path.join(root, 'public/hamsters/edits', filename));
  if (sha(bytes) !== filename.slice(0, -4)) throw new WardrobeStoreError('의상 수정 파일이 손상되었습니다.', 500);
  return bytes;
}

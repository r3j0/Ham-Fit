import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readSourceCatalog } from './source-catalog';
import { applyPlacements, EMPTY_PLACEMENTS, mergePlacementChanges, parsePlacementDocument } from '../components/hamster/placements';
import type { ItemCatalog } from '../components/hamster/types';
import type { PlacementChange } from '../components/hamster/placements';
import { applyArtwork } from '../components/hamster/artwork';
import { readArtworkStore } from './artwork-store';
import { WardrobeStoreError } from './wardrobe-errors';

export const PLACEMENTS_FILE = '.local/placements.json';
export { WardrobeStoreError } from './wardrobe-errors';
export async function readWardrobeStore(root = process.cwd()) {
  let document;
  try { document = parsePlacementDocument(JSON.parse(await readFile(path.join(root, PLACEMENTS_FILE), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    document = { ...EMPTY_PLACEMENTS, entries: [] };
  }
  const revision = createHash('sha256').update(JSON.stringify(document)).digest('hex');
  return { document, revision };
}
export async function readWardrobeCatalog() {
  const [placements, artwork, catalog] = await Promise.all([readWardrobeStore(), readArtworkStore(), readSourceCatalog()]);
  return applyArtwork(applyPlacements(catalog, placements.document), artwork.document, catalog);
}
/** Atomic replacement plus a lock/revision check prevents lost updates from separate tabs/processes. */
export async function saveWardrobeChanges(revision: string, changes: PlacementChange[], root = process.cwd(), catalog?: ItemCatalog) {
  catalog ??= await readSourceCatalog(root);
  await mkdir(path.join(root, '.local'), { recursive: true });
  const file = path.join(root, PLACEMENTS_FILE);
  const lockFile = `${file}.lock`;
  let lock;
  try { lock = await open(lockFile, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WardrobeStoreError('다른 저장 작업이 진행 중입니다. 잠시 후 다시 저장해 주세요.', 409);
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const current = await readWardrobeStore(root);
    if (revision !== current.revision) throw new WardrobeStoreError('다른 창에서 조정값을 저장했습니다. 새로고침 후 다시 조정해 주세요.', 409);
    let document;
    try { document = mergePlacementChanges(catalog, current.document, changes); }
    catch (error) { throw new WardrobeStoreError((error as Error).message, 400); }
    await writeFile(temporary, JSON.stringify(document, null, 2) + '\n', 'utf8');
    await rename(temporary, file);
    return { document, revision: createHash('sha256').update(JSON.stringify(document)).digest('hex') };
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockFile);
  }
}

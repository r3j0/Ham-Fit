import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GENERATED_ITEMS } from '../components/hamster/catalog.generated';
import type { ItemCatalog } from '../components/hamster/types';
export async function readSourceCatalog(root = process.cwd()): Promise<ItemCatalog> {
  try { return JSON.parse(await readFile(path.join(root, '.local/catalog.json'), 'utf8')) as ItemCatalog; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return GENERATED_ITEMS; }
}

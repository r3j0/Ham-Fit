import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readSourceCatalog } from '../src/lib/source-catalog';
import { pullCatalog } from '../src/lib/publish';

test('an empty frontend snapshot clears old local drafts offline and keeps a backup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'avatar-empty-test-'));
  const previousRoot = process.cwd(), previousFetch = globalThis.fetch;
  const previousFrontend = process.env.AVATAR_FRONTEND_DIR;
  try {
    const manager = path.join(root, 'avatar-manager');
    const frontend = path.join(root, 'frontend');
    await mkdir(path.join(manager, '.local'), { recursive: true });
    await mkdir(path.join(frontend, 'public/hamsters/wardrobe'), { recursive: true });
    assert.deepEqual(await readSourceCatalog(manager), {});
    const old = { shirt: { slot: 'top', label: 'Old draft', poses: {} } };
    await writeFile(path.join(manager, '.local/catalog.json'), JSON.stringify(old));
    await writeFile(path.join(frontend, 'package.json'), JSON.stringify({ dependencies: { next: 'test fixture' } }));
    for (const name of ['catalog.json', 'source-catalog.json'])
      await writeFile(path.join(frontend, 'public/hamsters/wardrobe', name), JSON.stringify({ revision: 1, catalog: {} }));
    process.chdir(manager);
    process.env.AVATAR_FRONTEND_DIR = frontend;
    globalThis.fetch = async () => { throw new Error('Empty restoration must work offline'); };
    assert.deepEqual(await pullCatalog(), { layers: 0 });
    assert.deepEqual(await readSourceCatalog(manager), {});
    for (const name of ['placements.json', 'artwork.json'])
      assert.deepEqual(JSON.parse(await readFile(path.join(manager, '.local', name), 'utf8')).entries, []);
    const backups = await readdir(path.join(manager, '.local/backups'));
    assert.deepEqual(JSON.parse(await readFile(path.join(manager, '.local/backups', backups[0], 'catalog.json'), 'utf8')), old);
  } finally {
    globalThis.fetch = previousFetch;
    process.chdir(previousRoot);
    if (previousFrontend === undefined) delete process.env.AVATAR_FRONTEND_DIR;
    else process.env.AVATAR_FRONTEND_DIR = previousFrontend;
    await rm(root, { recursive: true, force: true });
  }
});

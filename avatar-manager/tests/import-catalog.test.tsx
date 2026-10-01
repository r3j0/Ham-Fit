import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { importCatalog, type ImportFile } from '../src/lib/import-catalog';
import { POST } from '../src/app/api/import/route';

async function draft() {
  const root = await mkdtemp(path.join(tmpdir(), 'avatar-import-test-'));
  await mkdir(path.join(root, '.local'));
  await writeFile(path.join(root, '.local/catalog.json'), JSON.stringify({ original: { label: 'Existing shirt', slot: 'top', poses: {} } }));
  await writeFile(path.join(root, '.local/placements.json'), 'existing placement fixture');
  await writeFile(path.join(root, '.local/artwork.json'), 'existing pixel fixture');
  return root;
}
async function files(id = 'new-shirt', status = 'passed'): Promise<ImportFile[]> {
  const png = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: '#c9f4d180' } }).png().toBuffer();
  const manifest = { schemaVersion: 1, setId: 'set-new', items: [{ id, slot: 'top', label: 'New shirt', frames: { basic: { cream: { src: 'top/basic-cream.png', qa: { status, reviewer: 'test fixture', reviewedAt: '2026-10-01T10:00:00Z' } } } } }] };
  return [{ relativePath: 'sets/set-new/manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) }, { relativePath: 'sets/set-new/top/basic-cream.png', bytes: png }];
}
test('adds a reviewed set while preserving existing products, placements and pixel edits', async () => {
  const root = await draft();
  try {
    const result = await importCatalog(await files(), root);
    assert.deepEqual(result, { added: ['new-shirt'], frames: 1, skippedFrames: 0 });
    const catalog = JSON.parse(await readFile(path.join(root, '.local/catalog.json'), 'utf8'));
    assert.equal(catalog.original.label, 'Existing shirt');
    const src = catalog['new-shirt'].poses.basic.cream.layers[0].src;
    assert.match(src, /^\/hamsters\/wardrobe\/imported\/[a-f0-9]{64}\.png$/);
    assert.ok((await readFile(path.join(root, 'public', src))).length > 0);
    assert.equal(await readFile(path.join(root, '.local/placements.json'), 'utf8'), 'existing placement fixture');
    assert.equal(await readFile(path.join(root, '.local/artwork.json'), 'utf8'), 'existing pixel fixture');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('rejects duplicate product IDs without replacing the existing snapshot', async () => {
  const root = await draft();
  try {
    const before = await readFile(path.join(root, '.local/catalog.json'), 'utf8');
    await assert.rejects(importCatalog(await files('original'), root), /이미 있는 상품 ID/);
    assert.equal(await readFile(path.join(root, '.local/catalog.json'), 'utf8'), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('invalid PNG, incomplete QA and traversal cannot change the local catalog', async () => {
  const root = await draft();
  try {
    const before = await readFile(path.join(root, '.local/catalog.json'), 'utf8');
    const bad = await files(); bad[1].bytes = Buffer.from('not PNG');
    await assert.rejects(importCatalog(bad, root));
    await assert.rejects(importCatalog(await files('new-shirt', 'pending'), root), /검수가 완료/);
    await assert.rejects(importCatalog([{ relativePath: 'set-new/../../outside.png', bytes: Buffer.from('bad') }], root), /경로/);
    assert.equal(await readFile(path.join(root, '.local/catalog.json'), 'utf8'), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('the folder import endpoint rejects foreign origins and nonlocal hosts', async () => {
  for (const headers of [{ host: '127.0.0.1:3002', origin: 'https://foreign.test' }, { host: 'foreign.test', origin: 'http://foreign.test' }]) {
    const result = await POST(new Request('http://localhost:3002/api/import', { method: 'POST', headers, body: 'invalid data' }));
    assert.equal(result.status, 403);
  }
});

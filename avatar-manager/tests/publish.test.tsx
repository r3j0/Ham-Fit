import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { publishDraft, pullCatalog } from '../src/lib/publish';
import { exportFrontendAssets } from '../src/lib/frontend-assets';
import { readWardrobeStore } from '../src/lib/wardrobe-store';
import { readArtworkStore } from '../src/lib/artwork-store';
import type { ItemCatalog } from '../src/components/hamster/types';

test('exports locally, checks one frontend manifest and sends one metadata request; never transfers PNGs over HTTP', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'avatar-static-test-'));
  const previousRoot = process.cwd(), previousFetch = globalThis.fetch;
  const keys = ['AVATAR_MANAGER_TOKEN', 'AVATAR_BACKEND_URL', 'AVATAR_FRONTEND_DIR', 'AVATAR_FRONTEND_URL'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    const manager = path.join(root, 'avatar-manager'), frontend = path.join(root, 'frontend');
    await mkdir(path.join(manager, '.local'), { recursive: true });
    await mkdir(path.join(manager, 'public/hamsters/wardrobe/imported'), { recursive: true });
    await mkdir(frontend);
    await writeFile(path.join(frontend, 'package.json'), JSON.stringify({ dependencies: { next: 'test fixture' } }));
    const layers = [];
    for (let index = 0; index < 8; index++) {
      const bytes = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: { r: 120 + index, g: 200, b: 150, alpha: 0.5 } } }).png().toBuffer();
      const src = `/hamsters/wardrobe/imported/${index}.png`;
      await writeFile(path.join(manager, 'public', src), bytes);
      layers.push({ src, zIndex: 20 + index });
    }
    const catalog = { shirt: { slot: 'top', label: 'Test shirt', poses: { basic: { cream: { layers, qa: { status: 'passed', reviewer: 'test fixture', reviewedAt: '2026-10-01T10:00:00Z' } } } } } };
    await writeFile(path.join(manager, '.local/catalog.json'), JSON.stringify(catalog));
    process.chdir(manager);
    process.env.AVATAR_MANAGER_TOKEN = 'c'.repeat(64);
    process.env.AVATAR_BACKEND_URL = 'http://127.0.0.1:3301/api/v1';
    process.env.AVATAR_FRONTEND_DIR = frontend;
    process.env.AVATAR_FRONTEND_URL = 'https://frontend.example.test';
    const placements = await readWardrobeStore(), artwork = await readArtworkStore();
    const input = { revision: 0, products: [{ renderKey: 'shirt', price: 25, saleStatus: 'on_sale' }], combinations: [], reviewed: true, placementRevision: placements.revision, artworkRevision: artwork.revision };
    let calls: string[] = [], metadata: { products: { renderKey: string; price: number }[]; catalog?: ItemCatalog; sourceCatalog?: ItemCatalog } | undefined;
    globalThis.fetch = async (value, init) => {
      const url = String(value); calls.push(url);
      assert.ok(!url.endsWith('.png') && !url.endsWith('/images'), 'PNG network traffic is forbidden');
      if (url.startsWith('https://frontend.example.test/')) return new Response(await readFile(path.join(frontend, 'public', new URL(url).pathname)), { headers: { 'content-type': 'application/json' } });
      assert.equal(url, 'http://127.0.0.1:3301/api/v2/avatar-manager/publish');
      assert.equal(init?.method, 'POST');
      const form = init?.body as FormData;
      assert.deepEqual([...form.keys()], ['metadata']);
      metadata = JSON.parse(await (form.get('metadata') as Blob).text());
      return Response.json({ revision: 1 });
    };
    await assert.rejects(publishDraft(input), /내보내기/);
    assert.equal(calls.length, 0);
    const exported = await exportFrontendAssets(input);
    assert.equal(exported.assets, 8); assert.equal(exported.added, 8); assert.equal(calls.length, 0);
    assert.equal((await exportFrontendAssets(input)).added, 0);
    assert.equal((await publishDraft(input)).revision, 1);
    assert.equal(calls.length, 2);
    assert.ok(metadata);
    assert.equal(metadata.catalog, undefined); assert.equal(metadata.sourceCatalog, undefined);
    assert.equal(metadata.products[0].renderKey, 'shirt'); assert.equal(metadata.products[0].price, 25);
    const display = JSON.parse(await readFile(path.join(frontend, 'public/hamsters/wardrobe/catalog.json'), 'utf8'));
    for (const layer of display.catalog.shirt.poses.basic.cream.layers) assert.match(layer.src, /^\/hamsters\/wardrobe\/assets\/[a-f0-9]{64}\.png$/);
    // Price-only registration still sends one metadata request and no image transfer.
    calls = []; await publishDraft({ ...input, products: [{ renderKey: 'shirt', price: 30, saleStatus: 'on_sale' }] }); assert.equal(calls.length, 2);
    calls = [];
    globalThis.fetch = async value => { calls.push(String(value)); throw new Error('Frontend restoration must work offline'); };
    await pullCatalog(); assert.equal(calls.length, 0);
    // Pull restores editable originals using local frontend files, without PNG downloads.
    const restored = JSON.parse(await readFile(path.join(manager, '.local/catalog.json'), 'utf8'));
    assert.match(restored.shirt.poses.basic.cream.layers[0].src, /^\/hamsters\/wardrobe\/server\//);
    const currentPlacement = await readWardrobeStore(), currentArtwork = await readArtworkStore();
    const currentInput = { ...input, placementRevision: currentPlacement.revision, artworkRevision: currentArtwork.revision };
    calls = [];
    globalThis.fetch = async value => { calls.push(String(value)); return new Response('missing', { status: 404 }); };
    await assert.rejects(publishDraft(currentInput), /배포되지/); assert.equal(calls.length, 1);
    // Geometry stays in frontend files and requires a new deployment, with no DB write.
    restored.shirt.poses.basic.cream.layers[0].x = 123;
    await writeFile(path.join(manager, '.local/catalog.json'), JSON.stringify(restored));
    await assert.rejects(publishDraft(currentInput), /내보내기/);
    const changed = await exportFrontendAssets(currentInput);
    assert.notEqual(changed.bundle, exported.bundle); assert.equal(changed.added, 0);
    const changedDisplay = JSON.parse(await readFile(path.join(frontend, 'public/hamsters/wardrobe/catalog.json'), 'utf8'));
    assert.equal(changedDisplay.catalog.shirt.poses.basic.cream.layers[0].x, 123);
    calls = [];
    globalThis.fetch = async value => { calls.push(String(value)); return Response.json({ schemaVersion: 1, bundle: exported.bundle }); };
    await assert.rejects(publishDraft(currentInput), /버전이 다릅니다/); assert.equal(calls.length, 1);
    // Source symlinks cannot export arbitrary files outside the manager's image root.
    await writeFile(path.join(root, 'outside.png'), await readFile(path.join(manager, 'public', layers[0].src)));
    await symlink(path.join(root, 'outside.png'), path.join(manager, 'public/hamsters/escape.png'));
    catalog.shirt.poses.basic.cream.layers[0].src = '/hamsters/escape.png';
    await writeFile(path.join(manager, '.local/catalog.json'), JSON.stringify(catalog));
    await assert.rejects(exportFrontendAssets(currentInput), /벗어납니다/);
  } finally {
    globalThis.fetch = previousFetch; process.chdir(previousRoot);
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await rm(root, { recursive: true, force: true });
  }
});

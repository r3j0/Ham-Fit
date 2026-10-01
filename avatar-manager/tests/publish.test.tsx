import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { publishDraft } from '../src/lib/publish';
import { readWardrobeStore } from '../src/lib/wardrobe-store';
import { readArtworkStore } from '../src/lib/artwork-store';
import type { ItemCatalog } from '../src/components/hamster/types';

test('uploads a bounded batch and publishes image links only after every upload succeeds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'avatar-publish-test-'));
  const previousRoot = process.cwd(), previousFetch = globalThis.fetch;
  const previousToken = process.env.AVATAR_MANAGER_TOKEN, previousBase = process.env.AVATAR_BACKEND_URL;
  try {
    await mkdir(path.join(root, '.local'));
    await mkdir(path.join(root, 'public/hamsters/wardrobe/imported'), { recursive: true });
    const layers = [];
    for (let index = 0; index < 8; index++) {
      const bytes = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: { r: 120 + index, g: 200, b: 150, alpha: 0.5 } } }).png().toBuffer();
      const src = `/hamsters/wardrobe/imported/${index}.png`;
      await writeFile(path.join(root, 'public', src), bytes);
      layers.push({ src, zIndex: 20 + index });
    }
    const catalog = { shirt: { slot: 'top', label: 'Test shirt', poses: { basic: { cream: { layers, qa: { status: 'passed', reviewer: 'test fixture', reviewedAt: '2026-10-01T10:00:00Z' } } } } } };
    await writeFile(path.join(root, '.local/catalog.json'), JSON.stringify(catalog));
    process.chdir(root);
    process.env.AVATAR_MANAGER_TOKEN = 'c'.repeat(64);
    process.env.AVATAR_BACKEND_URL = 'http://127.0.0.1:3301/api/v1';
    let active = 0, maximum = 0, complete = 0;
    let metadata: { catalog: ItemCatalog; sourceCatalog: ItemCatalog } | undefined;
    globalThis.fetch = async (input, init) => {
      const url = String(input), form = init?.body as FormData;
      if (url.endsWith('/images')) {
        active++; maximum = Math.max(maximum, active);
        const png = form.get('png') as Blob;
        const hash = createHash('sha256').update(Buffer.from(await png.arrayBuffer())).digest('hex');
        await new Promise(resolve => setImmediate(resolve));
        active--; complete++;
        return Response.json({ src: `/api/v1/avatar/assets/${hash}.png`, sha256: hash });
      }
      assert.ok(url.endsWith('/publish'));
      assert.equal(complete, 8);
      assert.equal(active, 0);
      metadata = JSON.parse(await (form.get('metadata') as Blob).text());
      return Response.json({ revision: 1 });
    };
    const placements = await readWardrobeStore(), artwork = await readArtworkStore();
    const result = await publishDraft({ revision: 0, products: [{ renderKey: 'shirt', price: 25, saleStatus: 'on_sale' }], combinations: [], reviewed: true, placementRevision: placements.revision, artworkRevision: artwork.revision });
    assert.equal(result.revision, 1);
    assert.ok(maximum > 1 && maximum <= 6);
    assert.ok(metadata);
    for (const value of [metadata.catalog, metadata.sourceCatalog]) for (const layer of value.shirt.poses.basic!.cream!.layers) assert.match(layer.src, /^\/api\/v1\/avatar\/assets\/[a-f0-9]{64}\.png$/);
  } finally {
    globalThis.fetch = previousFetch; process.chdir(previousRoot);
    if (previousToken === undefined) delete process.env.AVATAR_MANAGER_TOKEN; else process.env.AVATAR_MANAGER_TOKEN = previousToken;
    if (previousBase === undefined) delete process.env.AVATAR_BACKEND_URL; else process.env.AVATAR_BACKEND_URL = previousBase;
    await rm(root, { recursive: true, force: true });
  }
});

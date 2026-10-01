import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { Hamster } from '../src/components/hamster/Hamster';
import { applyPlacements, EMPTY_PLACEMENTS, layerPlacement, mergePlacementChanges, parsePlacementDocument, placementSource } from '../src/components/hamster/placements';
import type { PlacementChange } from '../src/components/hamster/placements';
import type { ItemCatalog } from '../src/components/hamster/types';
import { PLACEMENTS_FILE, readWardrobeStore, saveWardrobeChanges } from '../src/lib/wardrobe-store';
import { PUT } from '../src/app/api/wardrobe/route';

const frame = { layers: [{ src: '/shirt.png', zIndex: 20 }], foreground: [{ src: '/paws.png', zIndex: 25 }], qa: { status: 'passed', reviewer: 'Test', reviewedAt: '2026-10-01T00:00:00Z' } };
const catalog = { shirt: { slot: 'top', label: 'Shirt', poses: { basic: { cream: frame, gray: frame }, run: { shared: frame } } } } as const satisfies ItemCatalog;
const change: PlacementChange = { itemId: 'shirt', pose: 'basic', variant: 'cream', group: 'layers', index: 0, source: placementSource(frame.layers[0], frame), placement: { x: 125, y: -60, width: 800, height: 800, rotation: 15 } };

test('placements isolate exact pose/color/layer and preserve original catalog, QA, and z order', () => {
  const before = JSON.stringify(catalog);
  const doc = mergePlacementChanges(catalog, EMPTY_PLACEMENTS, [change]);
  const result = applyPlacements(catalog, doc);
  assert.deepEqual(layerPlacement(result.shirt.poses.basic!.cream!.layers[0]), change.placement);
  assert.deepEqual(result.shirt.poses.basic!.gray, frame);
  assert.equal(result.shirt.poses.basic!.cream!.foreground![0], frame.foreground[0]);
  assert.equal(result.shirt.poses.basic!.cream!.qa, frame.qa);
  assert.equal(result.shirt.poses.basic!.cream!.layers[0].zIndex, 20);
  assert.equal(JSON.stringify(catalog), before);
  const html = renderToStaticMarkup(<Hamster catalog={result} top="shirt" />);
  assert.match(html, /rotate\(15 525 340\)/);
});
test('separate foreground and shared edits accumulate; reset removes only the targeted override', () => {
  const foreground: PlacementChange = { ...change, group: 'foreground', source: placementSource(frame.foreground[0], frame), placement: { x: 10, y: 20, width: 900, height: 900, rotation: -5 } };
  const shared: PlacementChange = { ...change, pose: 'run', variant: 'shared' };
  const doc = mergePlacementChanges(catalog, EMPTY_PLACEMENTS, [change, foreground, shared]);
  const reset = mergePlacementChanges(catalog, doc, [{ ...change, placement: null }]);
  assert.equal(reset.entries.length, 2);
  const result = applyPlacements(catalog, reset);
  assert.deepEqual(layerPlacement(result.shirt.poses.basic!.cream!.layers[0]), layerPlacement(frame.layers[0]));
  assert.equal(result.shirt.poses.basic!.cream!.foreground![0].x, 10);
  assert.equal(result.shirt.poses.run!.shared!.layers[0].x, 125);
});
test('independent width/height changes stretch only the garment; uniform scaling keeps its aspect ratio', () => {
  const doc = mergePlacementChanges(catalog, EMPTY_PLACEMENTS, [{ ...change, placement: { ...change.placement!, height: 600 } }]);
  const html = renderToStaticMarkup(<Hamster catalog={applyPlacements(catalog, doc)} top="shirt" />);
  assert.match(html, /data-layer="top:shirt:0"[^>]*preserveAspectRatio="none"/);
  assert.match(html, /data-layer="base"[^>]*preserveAspectRatio="xMidYMid meet"/);
});
test('reimports retain compatible adjustments and ignore obsolete layers/review revisions', () => {
  const doc = mergePlacementChanges(catalog, EMPTY_PLACEMENTS, [change]);
  const reimport = JSON.parse(JSON.stringify(catalog));
  assert.equal(applyPlacements(reimport, doc).shirt.poses.basic!.cream!.layers[0].x, 125);
  reimport.shirt.poses.basic.cream.qa.reviewedAt = '2026-10-02T00:00:00Z';
  assert.equal(applyPlacements(reimport, doc).shirt.poses.basic!.cream!.layers[0].x, undefined);
  assert.deepEqual(applyPlacements({}, doc), {});
  assert.throws(() => mergePlacementChanges(reimport, doc, [change]), /의상이 변경/);
});
test('bad geometry, unknown or prototype targets, duplicate changes, and corrupted documents are rejected', () => {
  for (const invalid of [
    { ...change, placement: { ...change.placement!, width: 0 } },
    { ...change, placement: { ...change.placement!, rotation: Infinity } },
    { ...change, placement: { ...change.placement!, x: 2001 } },
    { ...change, itemId: '__proto__' }, { ...change, index: 12 },
    { ...change, pose: 'toilet' }, { ...change, source: 'changed' }, null,
  ]) assert.throws(() => mergePlacementChanges(catalog, EMPTY_PLACEMENTS, [invalid as PlacementChange]));
  assert.throws(() => mergePlacementChanges(catalog, EMPTY_PLACEMENTS, [change, change]));
  assert.throws(() => parsePlacementDocument({ schemaVersion: 1, entries: [{ ...change, placement: null }] }));
});
test('file saves survive reload, reject stale tab revisions, and atomically restore original geometry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hamster-placement-'));
  try {
    await mkdir(path.dirname(path.join(root, PLACEMENTS_FILE)), { recursive: true });
    const initial = await readWardrobeStore(root);
    const saved = await saveWardrobeChanges(initial.revision, [change], root, catalog);
    assert.deepEqual(await readWardrobeStore(root), saved);
    assert.equal(applyPlacements(catalog, saved.document).shirt.poses.basic!.cream!.layers[0].x, 125);
    await assert.rejects(saveWardrobeChanges(initial.revision, [{ ...change, placement: null }], root, catalog), /다른 창/);
    assert.deepEqual(await readWardrobeStore(root), saved);
    const restored = await saveWardrobeChanges(saved.revision, [{ ...change, placement: null }], root, catalog);
    assert.deepEqual(restored.document, EMPTY_PLACEMENTS);
    await writeFile(path.join(root, PLACEMENTS_FILE), 'corrupt');
    await assert.rejects(readWardrobeStore(root));
    assert.equal(await readFile(path.join(root, PLACEMENTS_FILE), 'utf8'), 'corrupt');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('save endpoint rejects remote/missing origins, bad JSON, and malformed changes before writing', async () => {
  for (const [url, origin] of [['http://localhost:3000/api/wardrobe', 'https://evil.example'], ['https://example.com/api/wardrobe', 'https://example.com'], ['http://localhost:3000/api/wardrobe', '']]) {
    const response = await PUT(new Request(url, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' }));
    assert.equal(response.status, 403);
  }
  for (const body of ['bad json', '{}', '{"revision":"x","changes":[]}']) {
    const response = await PUT(new Request('http://localhost:3000/api/wardrobe', { method: 'PUT', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body }));
    assert.equal(response.status, 400);
  }
});

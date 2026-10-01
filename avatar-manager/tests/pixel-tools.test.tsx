import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintPixelStroke, samplePixel, colorHex, pixelsEqual } from '../src/app/wardrobe/pixel-tools';

const blank = (size = 10) => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4) });
test('a 1px pen and eraser alter exactly the selected pixel, including complete alpha removal', () => {
  const bitmap = blank();
  paintPixelStroke(bitmap, { x: 4.8, y: 5.1 }, { x: 4.8, y: 5.1 }, 1, 'pen', [20, 80, 160, 255]);
  assert.deepEqual(samplePixel(bitmap, { x: 4, y: 5 }), [20, 80, 160, 255]);
  assert.equal(bitmap.data.filter((_, index) => index % 4 === 3 && bitmap.data[index] > 0).length, 1);
  paintPixelStroke(bitmap, { x: 4, y: 5 }, { x: 4, y: 5 }, 1, 'eraser', [0, 0, 0, 0]);
  assert.deepEqual(bitmap, blank());
});
test('fast pointer strokes cover intermediate pixels, clip to the canvas, and leave distant pixels intact', () => {
  const bitmap = blank();
  paintPixelStroke(bitmap, { x: -5, y: 4 }, { x: 15, y: 4 }, 1, 'pen', [255, 0, 0, 255]);
  for (let x = 0; x < 10; x++) assert.deepEqual(samplePixel(bitmap, { x, y: 4 }), [255, 0, 0, 255]);
  assert.deepEqual(samplePixel(bitmap, { x: 5, y: 3 }), [0, 0, 0, 0]);
});
test('brush diameter scales, source-over opacity mixes correctly, and eyedropper preserves RGBA', () => {
  const bitmap = blank();
  paintPixelStroke(bitmap, { x: 5, y: 5 }, { x: 5, y: 5 }, 4, 'pen', [0, 0, 255, 255]);
  assert.equal(samplePixel(bitmap, { x: 7, y: 5 })![3], 255);
  assert.equal(samplePixel(bitmap, { x: 8, y: 5 })![3], 0);
  paintPixelStroke(bitmap, { x: 5, y: 5 }, { x: 5, y: 5 }, 1, 'pen', [255, 0, 0, 128]);
  assert.deepEqual(samplePixel(bitmap, { x: 5, y: 5 }), [128, 0, 127, 255]);
  assert.equal(colorHex([128, 0, 127, 255]), '#80007f');
  assert.equal(samplePixel(bitmap, { x: -1, y: 5 }), null);
});
test('painting transparent space with an eraser is a no-op and a saved snapshot is immutable', () => {
  const bitmap = blank(), snapshot = new Uint8ClampedArray(bitmap.data);
  assert.equal(paintPixelStroke(bitmap, { x: 5, y: 5 }, { x: 5, y: 5 }, 20, 'eraser', [0, 0, 0, 0]), null);
  assert.equal(pixelsEqual(bitmap.data, snapshot), true);
  paintPixelStroke(bitmap, { x: 5, y: 5 }, { x: 5, y: 5 }, 1, 'pen', [1, 2, 3, 255]);
  assert.equal(pixelsEqual(bitmap.data, snapshot), false);
  assert.equal(snapshot.every(channel => channel === 0), true);
});

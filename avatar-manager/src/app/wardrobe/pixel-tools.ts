export type PixelTool = 'pen' | 'eraser' | 'eyedropper';
export interface PixelPoint { x: number; y: number }
export type PixelColor = readonly [number, number, number, number];
export interface PixelBitmap { width: number; height: number; data: Uint8ClampedArray }
export const colorHex = (color: PixelColor) => '#' + color.slice(0, 3).map(channel => channel.toString(16).padStart(2, '0')).join('');
export function samplePixel(bitmap: PixelBitmap, point: PixelPoint): PixelColor | null {
  const x = Math.floor(point.x), y = Math.floor(point.y);
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return null;
  const index = (y * bitmap.width + x) * 4;
  return [bitmap.data[index], bitmap.data[index + 1], bitmap.data[index + 2], bitmap.data[index + 3]];
}
export function pixelsEqual(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  return a.length === b.length && a.every((channel, index) => channel === b[index]);
}
/** Hard pixel edges remove the entire alpha of a stray pixel, even with a 1px eraser at high zoom. */
export function paintPixelStroke(bitmap: PixelBitmap, from: PixelPoint, to: PixelPoint, size: number, tool: 'pen' | 'eraser', color: PixelColor) {
  const start = { x: Math.floor(from.x) + .5, y: Math.floor(from.y) + .5 };
  const end = { x: Math.floor(to.x) + .5, y: Math.floor(to.y) + .5 };
  const radius = Math.max(1, Math.min(160, Math.round(size))) / 2;
  const left = Math.max(0, Math.floor(Math.min(start.x, end.x) - radius));
  const top = Math.max(0, Math.floor(Math.min(start.y, end.y) - radius));
  const right = Math.min(bitmap.width, Math.ceil(Math.max(start.x, end.x) + radius));
  const bottom = Math.min(bitmap.height, Math.ceil(Math.max(start.y, end.y) + radius));
  const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy;
  let changed = false;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x + .5 - start.x) * dx + (y + .5 - start.y) * dy) / lengthSquared)) : 0;
    if ((x + .5 - start.x - t * dx) ** 2 + (y + .5 - start.y - t * dy) ** 2 > radius ** 2) continue;
    const index = (y * bitmap.width + x) * 4;
    let next: PixelColor = [0, 0, 0, 0];
    if (tool === 'pen') {
      const alpha = color[3] / 255, oldAlpha = bitmap.data[index + 3] / 255;
      const combined = alpha + oldAlpha * (1 - alpha);
      next = combined ? [
        Math.round((color[0] * alpha + bitmap.data[index] * oldAlpha * (1 - alpha)) / combined),
        Math.round((color[1] * alpha + bitmap.data[index + 1] * oldAlpha * (1 - alpha)) / combined),
        Math.round((color[2] * alpha + bitmap.data[index + 2] * oldAlpha * (1 - alpha)) / combined), Math.round(combined * 255),
      ] : next;
    }
    for (let channel = 0; channel < 4; channel++) {
      if (bitmap.data[index + channel] !== next[channel]) { bitmap.data[index + channel] = next[channel]; changed = true; }
    }
  }
  return changed ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

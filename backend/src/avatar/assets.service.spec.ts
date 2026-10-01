import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AvatarAssetsService } from './assets.service.js';
import type { DatabaseService } from '../database/database.service.js';
function payload() {
  return {
    revision: 0,
    products: [
      {
        renderKey: 'shirt',
        slot: 'top',
        price: 25,
        saleStatus: 'on_sale',
        frames: [{ pose: 'basic', variant: 'cream' }],
      },
    ],
    reviewed: true,
    combinations: [],
  };
}
describe('commercial metadata publication', () => {
  it('starts one DB transaction without reading images, placements, or calling storage', async () => {
    const transaction = vi.fn(async () => ({ revision: 1 }));
    const fetch = vi.fn(() => {
      throw new Error('Image network access is forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const service = new AvatarAssetsService({
        $transaction: transaction,
      } as unknown as DatabaseService);
      await expect(service.publish(payload())).resolves.toEqual({
        revision: 1,
      });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each(['catalog', 'sourceCatalog', 'image', 'x', 'rotation'])(
    'rejects display metadata in the commercial API: %s',
    async (key) => {
      const transaction = vi.fn();
      const service = new AvatarAssetsService({
        $transaction: transaction,
      } as unknown as DatabaseService);
      await expect(
        service.publish({ ...payload(), [key]: {} }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

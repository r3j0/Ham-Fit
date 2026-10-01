import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { AvatarAssetsService } from './assets.service.js';
import type { AvatarAssetFiles } from './assets-files.js';
import type { DatabaseService } from '../database/database.service.js';

function payload() {
  const layers = Array.from({ length: 14 }, (_, index) => ({
    src: `/api/v1/avatar/assets/${index.toString(16).padStart(64, '0')}.png`,
    zIndex: 20,
  }));
  const catalog = {
    shirt: {
      slot: 'top',
      label: 'Test shirt',
      poses: {
        basic: {
          cream: {
            layers,
            qa: {
              status: 'passed',
              reviewer: 'unit fixture',
              reviewedAt: '2026-10-01T10:00:00Z',
            },
          },
        },
      },
    },
  };
  return {
    catalog,
    sourceCatalog: structuredClone(catalog),
    revision: 0,
    products: [{ renderKey: 'shirt', price: 25, saleStatus: 'on_sale' }],
    reviewed: true,
    combinations: [],
  };
}

describe('publication with remote image verification', () => {
  it('bounds remote reads and waits for every PNG before starting the database transaction', async () => {
    const gates: (() => void)[] = [];
    const transaction = vi.fn(async () => ({ revision: 1 }));
    const verify = vi.fn(
      () => new Promise<void>((resolve) => gates.push(resolve)),
    );
    const service = new AvatarAssetsService(
      { $transaction: transaction } as unknown as DatabaseService,
      { verify } as unknown as AvatarAssetFiles,
    );
    const result = service.publish(payload());
    expect(verify).toHaveBeenCalledTimes(8);
    expect(transaction).not.toHaveBeenCalled();
    for (const release of gates.splice(0)) release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(verify).toHaveBeenCalledTimes(14);
    expect(gates).toHaveLength(6);
    expect(transaction).not.toHaveBeenCalled();
    for (const release of gates.splice(0)) release();
    await expect(result).resolves.toEqual({ revision: 1 });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('never starts a DB transaction if the image store is unavailable', async () => {
    const transaction = vi.fn();
    const verify = vi.fn().mockRejectedValue(new ServiceUnavailableException());
    const service = new AvatarAssetsService(
      { $transaction: transaction } as unknown as DatabaseService,
      { verify } as unknown as AvatarAssetFiles,
    );
    await expect(service.publish(payload())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

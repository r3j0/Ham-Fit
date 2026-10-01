import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarAssetStorage } from './assets-storage.js';
import { AvatarAssetFiles } from './assets-files.js';

const blob = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  objects: new Map<string, Buffer>(),
}));
vi.mock('@vercel/blob', () => ({ get: blob.get, put: blob.put }));
const service = () =>
  new AvatarAssetStorage(
    new ConfigService({
      AVATAR_ASSET_STORAGE: 'vercel-blob',
      BLOB_READ_WRITE_TOKEN: 'private-test-token',
    }),
  );
const filename = (bytes: Buffer) =>
  `${createHash('sha256').update(bytes).digest('hex')}.png`;

beforeEach(() => {
  blob.objects.clear();
  blob.get.mockReset();
  blob.put.mockReset();
  blob.get.mockImplementation(async (key: string) => {
    const bytes = blob.objects.get(key);
    return bytes
      ? {
          statusCode: 200,
          stream: new Response(new Uint8Array(bytes)).body,
          blob: { size: bytes.length },
        }
      : null;
  });
  blob.put.mockImplementation(async (key: string, bytes: Buffer) => {
    if (blob.objects.has(key)) throw new Error('Object already exists');
    blob.objects.set(key, Buffer.from(bytes));
  });
});

describe('durable avatar PNG storage', () => {
  it('reuses immutable private PNGs and reads them from a fresh service without local files', async () => {
    const bytes = Buffer.from('fixture image bytes'),
      name = filename(bytes);
    await service().write(name, bytes);
    await service().write(name, bytes);
    expect(blob.put).toHaveBeenCalledTimes(1);
    expect(blob.put).toHaveBeenCalledWith(
      `avatar-assets/${name}`,
      bytes,
      expect.objectContaining({
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'image/png',
      }),
    );
    expect(await service().read(name)).toEqual(bytes);
  });
  it('handles two uploads of the same hash racing without replacing existing bytes', async () => {
    const bytes = Buffer.from('same PNG'),
      name = filename(bytes);
    await Promise.all([
      service().write(name, bytes),
      service().write(name, bytes),
    ]);
    expect(blob.objects.size).toBe(1);
    expect(await service().read(name)).toEqual(bytes);
  });
  it('rejects damaged objects and never overwrites them', async () => {
    const bytes = Buffer.from('real image'),
      name = filename(bytes);
    blob.objects.set(`avatar-assets/${name}`, Buffer.from('damaged image'));
    await expect(service().read(name)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service().write(name, bytes)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(blob.put).not.toHaveBeenCalled();
  });
  it('returns 404 for absent PNGs and rejects unsafe filenames before contacting storage', async () => {
    await expect(
      service().read(filename(Buffer.from('missing'))),
    ).rejects.toBeInstanceOf(NotFoundException);
    blob.get.mockClear();
    await expect(service().read('../private.png')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(blob.get).not.toHaveBeenCalled();
  });
  it('returns a storage error without exposing provider credentials', async () => {
    blob.put.mockRejectedValue(new Error('private-test-token: access denied'));
    const bytes = Buffer.from('image'),
      name = filename(bytes);
    await expect(service().write(name, bytes)).rejects.toThrow(
      '의상 이미지 저장소에 저장하지 못했습니다.',
    );
    blob.get.mockRejectedValue(new Error('private-test-token: access denied'));
    await expect(service().read(name)).rejects.toThrow(
      '의상 이미지 저장소에서 파일을 읽지 못했습니다.',
    );
  });
  it('reports a provider failure as 503 after PNG validation, rather than claiming the PNG is invalid', async () => {
    const png = await sharp({
      create: {
        width: 1000,
        height: 1000,
        channels: 4,
        background: '#ffffff80',
      },
    })
      .png()
      .toBuffer();
    blob.get.mockRejectedValue(new Error('storage unavailable'));
    await expect(
      new AvatarAssetFiles(service()).upload(png),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('keeps the file provider for local development and persists across service instances', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'avatar-storage-test-'),
    );
    try {
      const config = new ConfigService({ AVATAR_ASSET_DIR: directory });
      const bytes = Buffer.from('local PNG'),
        name = filename(bytes);
      await new AvatarAssetStorage(config).write(name, bytes);
      expect(await new AvatarAssetStorage(config).read(name)).toEqual(bytes);
      expect(blob.put).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

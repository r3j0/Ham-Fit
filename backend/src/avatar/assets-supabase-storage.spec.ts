import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarAssetStorage } from './assets-storage.js';

const objects = new Map<string, Buffer>();
const api = vi.fn<typeof fetch>();
const key = 'sb_secret_storage-test-only';
const name = (bytes: Buffer) =>
  `${createHash('sha256').update(bytes).digest('hex')}.png`;
const service = () =>
  new AvatarAssetStorage(
    new ConfigService({
      AVATAR_ASSET_STORAGE: 'supabase',
      SUPABASE_URL: 'https://storage-fixture.supabase.co',
      SUPABASE_SECRET_KEY: key,
    }),
  );
const failure = (status: number, code: string, message = code) =>
  Response.json({ code, message }, { status });

beforeEach(() => {
  objects.clear();
  api.mockReset();
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.origin).toBe('https://storage-fixture.supabase.co');
    expect(new Headers(init?.headers).get('apikey')).toBe(key);
    expect(init?.cache).toBe('no-store');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (url.pathname === '/storage/v1/bucket/avatar-assets')
      return Response.json({ id: 'avatar-assets', public: false });
    const filename = url.pathname.slice(
      '/storage/v1/object/avatar-assets/'.length,
    );
    if (init?.method === 'POST') {
      expect(new Headers(init.headers).get('x-upsert')).toBe('false');
      expect(new Headers(init.headers).get('content-type')).toBe('image/png');
      if (objects.has(filename)) return failure(409, 'ResourceAlreadyExists');
      objects.set(
        filename,
        Buffer.from(await new Response(init.body as BodyInit).arrayBuffer()),
      );
      return Response.json({ Key: `avatar-assets/${filename}` });
    }
    const bytes = objects.get(filename);
    return bytes
      ? new Response(new Uint8Array(bytes), {
          headers: { 'Content-Type': 'image/png' },
        })
      : failure(404, 'NoSuchKey');
  });
  vi.stubGlobal('fetch', api);
});
afterEach(() => vi.unstubAllGlobals());

describe('Supabase avatar Storage through the real SDK', () => {
  it('reuses immutable PNGs and downloads through a fresh service instance', async () => {
    const bytes = Buffer.from('reviewed image'),
      filename = name(bytes);
    await service().write(filename, bytes);
    await service().write(filename, bytes);
    expect(await service().read(filename)).toEqual(bytes);
    expect(
      api.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
    expect(objects.size).toBe(1);
  });
  it('accepts concurrent identical uploads and preserves different revisions', async () => {
    const bytes = Buffer.from('same artwork'),
      edited = Buffer.from('edited artwork');
    await Promise.all([
      service().write(name(bytes), bytes),
      service().write(name(bytes), bytes),
    ]);
    await service().write(name(edited), edited);
    expect(objects.size).toBe(2);
    expect(await service().read(name(bytes))).toEqual(bytes);
    expect(await service().read(name(edited))).toEqual(edited);
  });
  it('rejects corrupted content without overwriting it', async () => {
    const bytes = Buffer.from('original artwork'),
      filename = name(bytes);
    objects.set(filename, Buffer.from('corrupted'));
    await expect(service().write(filename, bytes)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service().read(filename)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
      false,
    );
  });
  it('returns 404 only for absent objects and rejects unsafe names without requests', async () => {
    await expect(
      service().read(name(Buffer.from('missing'))),
    ).rejects.toBeInstanceOf(NotFoundException);
    api.mockClear();
    await expect(service().read('../private.png')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service().write('../private.png', Buffer.from('bad')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(api).not.toHaveBeenCalled();
  });
  it.each([
    failure(404, 'NoSuchBucket'),
    failure(403, 'AccessDenied'),
    Response.json({ id: 'avatar-assets', public: true }),
  ])(
    'rejects a missing, inaccessible or public bucket as a storage configuration error',
    async (response) => {
      api.mockImplementation(async () => response.clone());
      await expect(
        service().read(name(Buffer.from('image'))),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        service().write(name(Buffer.from('image')), Buffer.from('image')),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );
  it('retries bucket validation after a transient failure', async () => {
    const storage = service(),
      bytes = Buffer.from('available after outage');
    objects.set(name(bytes), bytes);
    api.mockImplementationOnce(async () => failure(503, 'InternalError'));
    await expect(storage.read(name(bytes))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(await storage.read(name(bytes))).toEqual(bytes);
  });
  it('recognizes legacy object-not-found and duplicate responses', async () => {
    const bytes = Buffer.from('legacy response');
    api.mockImplementationOnce(async () => Response.json({ public: false }));
    api.mockImplementationOnce(async () =>
      Response.json(
        { statusCode: '404', message: 'Object not found' },
        { status: 400 },
      ),
    );
    api.mockImplementationOnce(async () => {
      objects.set(name(bytes), bytes);
      return Response.json(
        { statusCode: '409', message: 'The resource already exists' },
        { status: 400 },
      );
    });
    await expect(service().write(name(bytes), bytes)).resolves.toBeUndefined();
  });
  it('does not turn missing buckets or denied object access into missing-image errors or expose credentials', async () => {
    api.mockImplementationOnce(async () => Response.json({ public: false }));
    api.mockImplementation(async () =>
      failure(404, 'NoSuchBucket', `${key}: bucket missing`),
    );
    await expect(service().read(name(Buffer.from('image')))).rejects.toThrow(
      '의상 이미지 저장소에서 파일을 읽지 못했습니다.',
    );
    api.mockImplementationOnce(async () => Response.json({ public: false }));
    api.mockImplementation(async () => failure(401, 'InvalidJWT', key));
    await expect(
      service().write(name(Buffer.from('image')), Buffer.from('image')),
    ).rejects.toThrow('의상 이미지 저장소에 저장하지 못했습니다.');
  });
});

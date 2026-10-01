import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { get, put } from '@vercel/blob';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseStorageSettings } from '../config/supabase-storage.js';

const MAX_BYTES = 8 * 1024 * 1024;
const validFilename = /^[a-f0-9]{64}\.png$/;
const hash = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

@Injectable()
export class AvatarAssetStorage {
  private supabaseClient?: SupabaseClient;
  private bucketCheck?: Promise<void>;
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  kind(): 'file' | 'vercel-blob' | 'supabase' {
    return (
      this.config.get<'file' | 'vercel-blob' | 'supabase'>(
        'AVATAR_ASSET_STORAGE',
      ) ?? (this.config.get<string>('VERCEL') === '1' ? 'vercel-blob' : 'file')
    );
  }

  private supabase() {
    const settings = supabaseStorageSettings({
      SUPABASE_URL: this.config.get('SUPABASE_URL'),
      SUPABASE_SECRET_KEY: this.config.get('SUPABASE_SECRET_KEY'),
      SUPABASE_AVATAR_BUCKET: this.config.get('SUPABASE_AVATAR_BUCKET'),
    });
    this.supabaseClient ??= createClient(settings.url, settings.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => {
          const timeout = AbortSignal.timeout(30000);
          return fetch(input, {
            ...init,
            cache: 'no-store',
            signal: init?.signal
              ? AbortSignal.any([init.signal, timeout])
              : timeout,
          });
        },
      },
    });
    return { storage: this.supabaseClient.storage, bucket: settings.bucket };
  }

  private async supabaseBucket() {
    const { storage, bucket } = this.supabase();
    const check = (this.bucketCheck ??= (async () => {
      const { data, error } = await storage.getBucket(bucket);
      if (error || !data || data.public !== false)
        throw new Error('A private avatar bucket is required');
    })());
    try {
      await check;
    } catch (error) {
      this.bucketCheck = undefined;
      throw error;
    }
    return storage.from(bucket);
  }

  private async downloadSupabase(filename: string) {
    const bucket = await this.supabaseBucket();
    const { data, error } = await bucket.download(filename);
    if (error) {
      const details = error as typeof error & { code?: string };
      const code = details.code ?? details.statusCode;
      // Missing buckets, denied access and provider failures are configuration/storage errors, not absent PNGs.
      if (
        code === 'NoSuchKey' ||
        (details.statusCode === '404' &&
          ['Object not found', 'The resource was not found'].includes(
            details.message,
          ))
      )
        return null;
      throw error;
    }
    if (!data || data.size > MAX_BYTES) throw new Error('Invalid avatar image');
    return Buffer.from(await data.arrayBuffer());
  }

  private async writeSupabase(filename: string, png: Buffer) {
    const existing = await this.downloadSupabase(filename);
    if (existing) {
      if (!existing.equals(png)) throw new Error('Avatar image hash mismatch');
      return;
    }
    const bucket = await this.supabaseBucket();
    const { error } = await bucket.upload(filename, png, {
      upsert: false,
      contentType: 'image/png',
      cacheControl: '31536000',
    });
    if (error) {
      const details = error as typeof error & { code?: string };
      if (
        details.code !== 'ResourceAlreadyExists' &&
        details.code !== 'KeyAlreadyExists' &&
        details.statusCode !== '409' &&
        !(
          details.statusCode === '400' &&
          details.message === 'The resource already exists'
        )
      )
        throw error;
      // A concurrent publisher may win. Only reuse the exact same immutable content.
      const stored = await this.downloadSupabase(filename);
      if (!stored?.equals(png)) throw new Error('Avatar image hash mismatch');
    }
  }

  private directory() {
    return path.resolve(
      this.config.get<string>('AVATAR_ASSET_DIR') ?? '.local/avatar-assets',
    );
  }

  private blobOptions() {
    return {
      access: 'private' as const,
      token: this.config.get<string>('BLOB_READ_WRITE_TOKEN'),
      abortSignal: AbortSignal.timeout(30000),
    };
  }

  async write(filename: string, png: Buffer) {
    try {
      if (
        !validFilename.test(filename) ||
        png.length > MAX_BYTES ||
        hash(png) !== filename.slice(0, -4)
      )
        throw new Error('Invalid avatar image');
      if (this.kind() === 'supabase') {
        await this.writeSupabase(filename, png);
        return;
      }
      if (this.kind() === 'vercel-blob') {
        // Content-addressed objects never change. Re-registration reuses the same PNG.
        const existing = await get(`avatar-assets/${filename}`, {
          ...this.blobOptions(),
          useCache: false,
        });
        if (existing) {
          if (
            existing.statusCode !== 200 ||
            existing.blob.size > 8 * 1024 * 1024
          )
            throw new Error('Invalid avatar image');
          const stored = Buffer.from(
            await new Response(existing.stream).arrayBuffer(),
          );
          if (!stored.equals(png))
            throw new Error('Avatar image hash mismatch');
          return;
        }
        try {
          await put(`avatar-assets/${filename}`, png, {
            ...this.blobOptions(),
            addRandomSuffix: false,
            allowOverwrite: false,
            contentType: 'image/png',
            cacheControlMaxAge: 31536000,
          });
        } catch {
          // Two publishers may upload the same hash at once. Only accept the exact bytes.
          const stored = await this.read(filename, false);
          if (!stored.equals(png))
            throw new Error('Avatar image hash mismatch');
        }
        return;
      }
      await mkdir(this.directory(), { recursive: true });
      try {
        await writeFile(path.join(this.directory(), filename), png, {
          flag: 'wx',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await this.read(filename);
      }
    } catch {
      throw new ServiceUnavailableException(
        '의상 이미지 저장소에 저장하지 못했습니다. 저장소 연결을 확인하고 다시 등록하세요.',
      );
    }
  }

  async read(filename: string, useCache = true): Promise<Buffer> {
    if (!validFilename.test(filename))
      throw new NotFoundException('의상 이미지가 없습니다.');
    try {
      let bytes: Buffer;
      if (this.kind() === 'supabase') {
        const result = await this.downloadSupabase(filename);
        if (!result) throw new NotFoundException('의상 이미지가 없습니다.');
        bytes = result;
      } else if (this.kind() === 'vercel-blob') {
        const result = await get(`avatar-assets/${filename}`, {
          ...this.blobOptions(),
          useCache,
        });
        if (!result) throw new NotFoundException('의상 이미지가 없습니다.');
        if (result.statusCode !== 200 || result.blob.size > 8 * 1024 * 1024)
          throw new Error('Invalid avatar image');
        bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
      } else {
        bytes = await readFile(path.join(this.directory(), filename));
      }
      if (
        createHash('sha256').update(bytes).digest('hex') !==
        filename.slice(0, -4)
      )
        throw new Error('Avatar image hash mismatch');
      return bytes;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      )
        throw new NotFoundException('의상 이미지가 없습니다.');
      throw new ServiceUnavailableException(
        '의상 이미지 저장소에서 파일을 읽지 못했습니다.',
      );
    }
  }
}

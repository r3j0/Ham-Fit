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

@Injectable()
export class AvatarAssetStorage {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  kind(): 'file' | 'vercel-blob' {
    return (
      this.config.get<'file' | 'vercel-blob'>('AVATAR_ASSET_STORAGE') ??
      (this.config.get<string>('VERCEL') === '1' ? 'vercel-blob' : 'file')
    );
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
    if (!/^[a-f0-9]{64}\.png$/.test(filename))
      throw new NotFoundException('의상 이미지가 없습니다.');
    try {
      let bytes: Buffer;
      if (this.kind() === 'vercel-blob') {
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

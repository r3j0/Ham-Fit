import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AvatarAssetStorage } from './assets-storage.js';

export const MAX_PNG_BYTES = 8 * 1024 * 1024;
@Injectable()
export class AvatarAssetFiles {
  constructor(
    @Inject(AvatarAssetStorage) private readonly storage: AvatarAssetStorage,
  ) {}
  storageKind() {
    return this.storage.kind();
  }
  async upload(bytes: Buffer) {
    let png: Buffer;
    try {
      if (!bytes.length || bytes.length > MAX_PNG_BYTES) throw new Error();
      const image = sharp(bytes, { limitInputPixels: 1000000 });
      const metadata = await image.metadata();
      if (
        metadata.format !== 'png' ||
        metadata.width !== 1000 ||
        metadata.height !== 1000 ||
        !metadata.hasAlpha ||
        (metadata.pages ?? 1) !== 1
      )
        throw new Error();
      png = await image.ensureAlpha().png().toBuffer();
    } catch {
      throw new BadRequestException(
        '1000×1000 투명 PNG 파일이 필요합니다. 최대 크기는 8 MiB입니다.',
      );
    }
    const hash = createHash('sha256').update(png).digest('hex');
    await this.storage.write(`${hash}.png`, png);
    return { src: `/api/v1/avatar/assets/${hash}.png`, sha256: hash };
  }
  async read(filename: string) {
    return this.storage.read(filename);
  }
  async verify(filename: string, original: boolean) {
    const bytes = await this.read(filename);
    if (original) {
      const stats = await sharp(bytes).stats();
      const alpha = stats.channels.at(-1)!;
      if (alpha.min >= 255 || alpha.max === 0)
        throw new BadRequestException(
          '원본 의상에는 투명 배경과 보이는 픽셀이 필요합니다.',
        );
    }
  }
}

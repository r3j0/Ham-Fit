import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const MAX_PNG_BYTES = 8 * 1024 * 1024;
@Injectable()
export class AvatarAssetFiles {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  private directory() {
    return path.resolve(
      this.config.get<string>('AVATAR_ASSET_DIR') ?? '.local/avatar-assets',
    );
  }
  async upload(bytes: Buffer) {
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
      const png = await image.ensureAlpha().png().toBuffer();
      const hash = createHash('sha256').update(png).digest('hex');
      await mkdir(this.directory(), { recursive: true });
      try {
        await writeFile(path.join(this.directory(), `${hash}.png`), png, {
          flag: 'wx',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      return { src: `/api/v1/avatar/assets/${hash}.png`, sha256: hash };
    } catch {
      throw new BadRequestException(
        '1000×1000 투명 PNG 파일이 필요합니다. 최대 크기는 8 MiB입니다.',
      );
    }
  }
  async read(filename: string) {
    if (!/^[a-f0-9]{64}\.png$/.test(filename))
      throw new NotFoundException('의상 이미지가 없습니다.');
    let bytes: Buffer;
    try {
      bytes = await readFile(path.join(this.directory(), filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFoundException('의상 이미지가 없습니다.');
      throw error;
    }
    if (
      createHash('sha256').update(bytes).digest('hex') !== filename.slice(0, -4)
    )
      throw new Error('Avatar image hash mismatch');
    return bytes;
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

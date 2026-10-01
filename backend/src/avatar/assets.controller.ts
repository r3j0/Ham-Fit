import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { API_V1 } from '../config/api-version.js';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import { AvatarManagerGuard } from './assets.guard.js';
import { AvatarAssetFiles, MAX_PNG_BYTES } from './assets-files.js';
import { AvatarAssetsService } from './assets.service.js';

@Controller({ path: 'avatar-manager', version: API_V1 })
@UseGuards(AvatarManagerGuard)
export class AvatarManagerController {
  constructor(
    @Inject(AvatarAssetsService) private readonly assets: AvatarAssetsService,
    @Inject(AvatarAssetFiles) private readonly files: AvatarAssetFiles,
  ) {}
  @Get('catalog') @Header('Cache-Control', 'no-store') catalog() {
    return this.assets.managerCatalog();
  }
  @Post('images')
  @UseInterceptors(
    FileInterceptor('png', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PNG_BYTES, files: 1, fields: 0 },
    }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('PNG 파일이 필요합니다.');
    return this.files.upload(file.buffer);
  }
  @Post('publish')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('metadata', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
    }),
  )
  publish(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('등록 정보가 필요합니다.');
    let data: unknown;
    try {
      data = JSON.parse(file.buffer.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('JSON 등록 정보가 올바르지 않습니다.');
    }
    return this.assets.publish(data);
  }
}
@Controller({ path: 'avatar', version: API_V1 })
export class AvatarAssetsController {
  constructor(
    @Inject(AvatarAssetsService) private readonly assets: AvatarAssetsService,
    @Inject(AvatarAssetFiles) private readonly files: AvatarAssetFiles,
  ) {}
  @Get('render-catalog')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard, AuthRequestGuard)
  catalog() {
    return this.assets.catalog();
  }
  @Get('assets/:filename')
  async image(@Param('filename') filename: string, @Res() response: Response) {
    const png = await this.files.read(filename);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.type('image/png').send(png);
  }
}

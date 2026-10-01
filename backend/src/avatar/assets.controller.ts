import {
  BadRequestException,
  Controller,
  Get,
  GoneException,
  Header,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { API_V1 } from '../config/api-version.js';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import { AvatarManagerGuard } from './assets.guard.js';
import { AvatarAssetsService } from './assets.service.js';

function retiredImages(): never {
  throw new GoneException({
    code: 'FRONTEND_ASSETS_REQUIRED',
    message:
      '의상 이미지는 프론트엔드 정적 파일로 배포하세요. 최신 편집기의 v2 등록은 상품 ID·가격만 등록합니다.',
  });
}

@Controller({ path: 'avatar-manager', version: API_V1 })
@UseGuards(AvatarManagerGuard)
export class AvatarManagerController {
  @Get('catalog') catalog() {
    return retiredImages();
  }
  // Reject old editors before Multer, Sharp, or any storage request runs.
  @Post('images') upload() {
    return retiredImages();
  }
  @Post('publish') publish() {
    return retiredImages();
  }
}

@Controller({ path: 'avatar-manager', version: '2' })
@UseGuards(AvatarManagerGuard)
export class AvatarManagerV2Controller {
  constructor(
    @Inject(AvatarAssetsService) private readonly assets: AvatarAssetsService,
  ) {}
  @Get('catalog') @Header('Cache-Control', 'no-store') catalog() {
    return this.assets.managerCatalog();
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
  @Get('render-catalog')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard, AuthRequestGuard)
  catalog() {
    return retiredImages();
  }
  @Get('assets/:filename') image() {
    return retiredImages();
  }
}

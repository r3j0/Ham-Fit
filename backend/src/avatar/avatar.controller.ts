import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import {
  avatarError,
  parseOutfit,
  parseOutfitRevision,
  parsePurchase,
  parseBatchPurchase,
  parsePurchaseKey,
} from './avatar-input.js';
import { AvatarService } from './avatar.service.js';

@Controller({ path: 'shop', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class ShopController {
  constructor(@Inject(AvatarService) private readonly avatar: AvatarService) {}

  @Get('products')
  @Header('Cache-Control', 'no-store')
  catalog() {
    return this.avatar.catalog();
  }

  @Post('purchases')
  @Header('Cache-Control', 'no-store')
  async purchase(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.is('application/json'))
      avatarError(400, 'INVALID_INPUT', 'JSON 요청이 필요합니다.');
    const result = await this.avatar.purchase(
      request.user.id,
      parsePurchaseKey(key),
      parsePurchase(body),
    );
    response.status(result.replayed ? 200 : 201);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result;
  }
  @Post('purchases/batch')
  @Header('Cache-Control', 'no-store')
  async purchaseBatch(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.is('application/json'))
      avatarError(400, 'INVALID_INPUT', 'JSON 요청이 필요합니다.');
    const result = await this.avatar.purchaseBatch(
      request.user.id,
      parsePurchaseKey(key),
      parseBatchPurchase(body),
    );
    response.status(result.replayed ? 200 : 201);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result;
  }
}

@Controller({ path: 'users/me/avatar', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class AvatarController {
  constructor(@Inject(AvatarService) private readonly avatar: AvatarService) {}

  @Get('inventory')
  @Header('Cache-Control', 'no-store')
  inventory(@Req() request: AuthenticatedRequest) {
    return this.avatar.inventory(request.user.id);
  }

  @Get('outfit')
  @Header('Cache-Control', 'no-store')
  async outfit(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const outfit = await this.avatar.outfit(request.user.id);
    response.setHeader('ETag', `"${outfit.revision}"`);
    return outfit;
  }

  @Put('outfit')
  @Header('Cache-Control', 'no-store')
  async save(
    @Req() request: AuthenticatedRequest,
    @Headers('if-match') revision: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.is('application/json'))
      avatarError(400, 'INVALID_INPUT', 'JSON 요청이 필요합니다.');
    const outfit = await this.avatar.saveOutfit(
      request.user.id,
      parseOutfitRevision(revision),
      parseOutfit(body),
    );
    response.setHeader('ETag', `"${outfit.revision}"`);
    return outfit;
  }
}

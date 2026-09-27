import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AccessTokenGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1, API_V1_BASE_PATH } from '../config/api-version.js';
import { parseCreateKey, parseId } from '../measurements/measurement-input.js';
import { playbackInvalid, parsePlaybackEvent } from './playback.js';
import { RecommendationsService } from './recommendations.service.js';

@Controller({ path: 'workouts', version: API_V1 })
@UseGuards(AccessTokenGuard)
export class RecommendationsController {
  constructor(
    @Inject(RecommendationsService)
    private readonly workouts: RecommendationsService,
  ) {}

  @Post('today')
  async today(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!z.strictObject({}).safeParse(body ?? {}).success)
      playbackInvalid(
        '오늘 추천 요청에는 날짜나 영상 ID를 지정할 수 없습니다.',
      );
    const result = await this.workouts.today(
      request.user.id,
      parseCreateKey(key),
    );
    response.status(result.replayed ? 200 : 201);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.setHeader(
      'Location',
      `${API_V1_BASE_PATH}/workouts/${result.assignment.id}`,
    );
    return result.assignment;
  }
  @Get('current')
  async current(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    // Nest's default null handling sends an empty body; this contract is JSON null.
    return response.json(await this.workouts.current(request.user.id));
  }
  @Get('history')
  history(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const parsed = z
      .strictObject({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.uuid().optional(),
      })
      .safeParse(query);
    if (!parsed.success) playbackInvalid('이력 조회 조건을 확인해 주세요.');
    return this.workouts.history(
      request.user.id,
      parsed.data.limit,
      parsed.data.cursor,
    );
  }
  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.workouts.get(request.user.id, parseId(id));
  }
  @Post(':id/events')
  @HttpCode(200)
  async event(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.workouts.event(
      request.user.id,
      parseId(id),
      parseCreateKey(key),
      parsePlaybackEvent(body),
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.assignment;
  }
}

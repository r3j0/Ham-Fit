import {
  Body,
  Controller,
  Get,
  GoneException,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Version,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1, API_V2, API_V2_BASE_PATH } from '../config/api-version.js';
import { parseCreateKey, parseId } from '../measurements/measurement-input.js';
import { parsePlaybackEvent, playbackInvalid } from './playback.js';
import { WorkoutRoutinesService } from './workout-routines.service.js';

@Controller({ path: 'workout-routines', version: API_V2 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class WorkoutRoutinesController {
  constructor(
    @Inject(WorkoutRoutinesService)
    private readonly routines: WorkoutRoutinesService,
  ) {}

  @Post('today')
  async today(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      !request.is('application/json') ||
      !z.strictObject({}).safeParse(body).success
    )
      playbackInvalid('추천 요청은 빈 JSON 객체만 허용합니다.');
    const result = await this.routines.today(
      request.user.id,
      parseCreateKey(key),
    );
    response.status(result.replayed ? 200 : 201);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.setHeader(
      'Location',
      `${API_V2_BASE_PATH}/workout-routines/${result.routine.id}`,
    );
    return result.routine;
  }
  @Version(API_V1)
  @Post(['next', ':id/items/:itemId/events'])
  retiredMutation() {
    this.retired();
  }
  @Version(API_V1)
  @Get(['current', 'history', ':id'])
  retiredRead() {
    this.retired();
  }
  private retired(): never {
    throw new GoneException({
      statusCode: 410,
      code: 'ROUTINE_API_RETIRED',
      message:
        '당일 루틴 API /api/v2/workout-routines를 사용해 주세요. 기존 기록도 v2에서 조회할 수 있습니다.',
    });
  }
  @Get('current')
  async current(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    return response.json(await this.routines.current(request.user.id));
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
    return this.routines.history(
      request.user.id,
      parsed.data.limit,
      parsed.data.cursor,
    );
  }
  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.routines.get(request.user.id, parseId(id));
  }
  @Post(':id/items/:itemId/events')
  @HttpCode(200)
  async event(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.is('application/json'))
      playbackInvalid('JSON 객체를 전달해 주세요.');
    const result = await this.routines.event(
      request.user.id,
      parseId(id),
      parseId(itemId),
      parseCreateKey(key),
      parsePlaybackEvent(body),
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.routine;
  }
}

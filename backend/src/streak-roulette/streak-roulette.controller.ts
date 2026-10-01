import {
  Body,
  Headers,
  Post,
  Res,
  Controller,
  Get,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { invalidUserInput } from '../users/user-input.js';
import { AccessTokenGuard, AuthRequestGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import { API_V1 } from '../config/api-version.js';
import {
  pageSchema,
  parseGroupInput,
  requestKey,
} from '../groups/group-input.js';
import { StreakRouletteService } from './streak-roulette.service.js';

const spinSchema = z.strictObject({
  ticketId: z.uuid().transform((id) => id.toLowerCase()),
});

@Controller({ path: 'users/me/streak-roulette', version: API_V1 })
@UseGuards(AccessTokenGuard, AuthRequestGuard)
export class StreakRouletteController {
  constructor(
    @Inject(StreakRouletteService)
    private readonly roulette: StreakRouletteService,
  ) {}

  @Get('tickets')
  tickets(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.roulette.tickets(
      request.user.id,
      parseGroupInput(pageSchema, query),
    );
  }
  @Post('spins')
  async spin(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.is('application/json'))
      invalidUserInput([
        { field: 'body', message: 'JSON 형식으로 입력해 주세요.' },
      ]);
    const input = parseGroupInput(spinSchema, body);
    const result = await this.roulette.spin(
      request.user.id,
      input.ticketId,
      requestKey(key),
    );
    response.status(result.replayed ? 200 : 201);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result;
  }
  @Get('draws')
  draws(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.roulette.draws(
      request.user.id,
      parseGroupInput(pageSchema, query),
    );
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.guards.js';
import {
  parseCatalogQuery,
  parseCreate,
  parseCreateKey,
  parseId,
  parseListQuery,
  parsePatch,
  parseRevision,
} from './measurement-input.js';
import { MeasurementCatalogService } from './measurement-catalog.service.js';
import { MeasurementsService } from './measurements.service.js';
import { API_V1, API_V1_BASE_PATH } from '../config/api-version.js';

@Controller({ path: 'measurement-catalog', version: API_V1 })
export class MeasurementCatalogController {
  constructor(
    @Inject(MeasurementCatalogService)
    private readonly catalogs: MeasurementCatalogService,
  ) {}

  @Get()
  get(@Query() query: unknown) {
    const input = parseCatalogQuery(query);
    return this.catalogs.get(input.version, input.age);
  }
}

@Controller({ path: 'measurements', version: API_V1 })
@UseGuards(AccessTokenGuard)
export class MeasurementsController {
  constructor(
    @Inject(MeasurementsService)
    private readonly measurements: MeasurementsService,
  ) {}

  @Post()
  @Header('Cache-Control', 'no-store, no-transform')
  async create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.measurements.create(
      request.user.id,
      parseCreateKey(key),
      parseCreate(body),
    );
    response.status(result.replayed ? 200 : 201);
    response.setHeader(
      'Location',
      `${API_V1_BASE_PATH}/measurements/${result.record.id}`,
    );
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    response.setHeader('ETag', `"${result.record.revision}"`);
    return result.record;
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.measurements.list(request.user.id, parseListQuery(query));
  }

  @Get('latest-polygon')
  latestPolygon(@Req() request: AuthenticatedRequest) {
    return this.measurements.latestPolygon(request.user.id);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store, no-transform')
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const record = await this.measurements.get(request.user.id, parseId(id));
    response.setHeader('ETag', `"${record.revision}"`);
    return record;
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store, no-transform')
  async patch(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('if-match') revision: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const record = await this.measurements.patch(
      request.user.id,
      parseId(id),
      parseRevision(revision),
      parsePatch(body),
    );
    response.setHeader('ETag', `"${record.revision}"`);
    return record;
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Headers('if-match') revision: unknown,
  ) {
    return this.measurements.delete(
      request.user.id,
      parseId(id),
      parseRevision(revision),
    );
  }
}

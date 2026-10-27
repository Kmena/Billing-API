import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import {
  ConsumerV2Guard,
  ConsumerV2Principal,
} from '../fiscal-consumers/infrastructure/http/consumer-v2.guard';
import { ConsumerV2RequiredScope } from '../fiscal-consumers/infrastructure/http/consumer-v2-scope.decorator';
import { W3ALabCorrectionService } from './w3-a-lab-correction.service';

@UseGuards(ConsumerV2Guard)
@Controller('api/v2/lab/companies/:companyId/fiscal-documents/:environment')
export class W3ALabCorrectionController {
  constructor(private readonly corrections: W3ALabCorrectionService) {}

  @Post('credit-notes')
  @ConsumerV2RequiredScope('fiscal-v2:credit-notes:create')
  credit(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.create('CREDIT_NOTE', request.consumerV2, body, key, correlation, response);
  }

  @Post('debit-notes')
  @ConsumerV2RequiredScope('fiscal-v2:debit-notes:create')
  debit(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlation: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.create('DEBIT_NOTE', request.consumerV2, body, key, correlation, response);
  }

  @Get('corrective-notes/:documentId')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  getDocument(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.corrections.getDocument(request.consumerV2, documentId);
  }

  @Post('corrective-notes/lookup')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async lookup(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException({ code: 'CORRECTION_LOOKUP_INVALID' });
    const query = body as Record<string, unknown>;
    if (
      Object.keys(query).some((key) => !['type', 'idempotencyKey', 'requestHash'].includes(key)) ||
      !['CREDIT_NOTE', 'DEBIT_NOTE'].includes(String(query.type)) ||
      typeof query.idempotencyKey !== 'string' ||
      typeof query.requestHash !== 'string'
    ) {
      throw new BadRequestException({ code: 'CORRECTION_LOOKUP_INVALID' });
    }
    const result = await this.corrections.lookup(
      request.consumerV2,
      query.type as 'CREDIT_NOTE' | 'DEBIT_NOTE',
      query.idempotencyKey,
      query.requestHash,
      randomUUID(),
    );
    response.setHeader('Cache-Control', 'no-store');
    if (result.status === 404 || result.status === 409)
      throw new HttpException({ code: result.code }, result.status);
    response.status(result.status);
    if (result.retryAfterSeconds)
      response.setHeader('Retry-After', String(result.retryAfterSeconds));
    return {
      state: result.state,
      fiscalDocumentId: result.fiscalDocumentId,
      ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
    };
  }

  private async create(
    kind: 'CREDIT_NOTE' | 'DEBIT_NOTE',
    principal: ConsumerV2Principal,
    intent: unknown,
    key: string | undefined,
    correlation: string | undefined,
    response: Response,
  ) {
    if (!key) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    if (
      correlation &&
      !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(correlation)
    ) {
      throw new BadRequestException({ code: 'CORRELATION_ID_INVALID' });
    }
    const result = await this.corrections.create(kind, {
      principal,
      idempotencyKey: key,
      intent,
      correlationId: correlation ?? randomUUID(),
    });
    response.status(result.httpStatus).setHeader('Cache-Control', 'no-store');
    if (result.httpStatus === 202) response.setHeader('Retry-After', '3');
    const { httpStatus: _status, ...safe } = result;
    return safe;
  }
}

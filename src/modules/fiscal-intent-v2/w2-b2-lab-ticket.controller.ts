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
import { W2AStructuralValidationError } from './w2-a-structural-intent';
import { W2BLabProjectionError } from './w2-b-lab-projection';
import { W2B2LabInvoiceService } from './w2-b2-lab-invoice.service';

/** Registered only by W2B2FiscalLabModule in disposable test applications. */
@UseGuards(ConsumerV2Guard)
@Controller('api/v2/lab/companies/:companyId/fiscal-documents/:environment/tickets')
export class W2B2LabTicketController {
  constructor(private readonly documents: W2B2LabInvoiceService) {}

  @Post()
  @ConsumerV2RequiredScope('fiscal-v2:tickets:create')
  async create(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') requestedCorrelationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!idempotencyKey) throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    if (
      requestedCorrelationId &&
      !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(
        requestedCorrelationId,
      )
    ) {
      throw new BadRequestException({ code: 'CORRELATION_ID_INVALID' });
    }
    try {
      const result = await this.documents.createTicket({
        principal: request.consumerV2,
        idempotencyKey,
        intent: body,
        correlationId: requestedCorrelationId ?? randomUUID(),
      });
      response.status(result.httpStatus).setHeader('Cache-Control', 'no-store');
      if (result.httpStatus === 202) response.setHeader('Retry-After', '3');
      const { httpStatus: _httpStatus, ...safe } = result;
      return safe;
    } catch (error) {
      if (error instanceof W2AStructuralValidationError) {
        throw new BadRequestException({ code: error.code, details: { path: error.path } });
      }
      if (error instanceof W2BLabProjectionError) {
        throw new HttpException(
          { code: error.code, details: { path: error.path } },
          error.code === 'W2B_TAX_POLICY_PENDING' ? 422 : 400,
        );
      }
      throw error;
    }
  }

  @Get(':documentId')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  getDocument(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.getDocument(request.consumerV2, documentId, ['TICKET']);
  }

  @Get(':documentId/signed-xml')
  @ConsumerV2RequiredScope('fiscal-v2:operations:read')
  async signedXml(
    @Req() request: { consumerV2: ConsumerV2Principal },
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Res() response: Response,
  ) {
    const artifact = await this.documents.signedTicketXml(request.consumerV2, documentId);
    response
      .status(200)
      .setHeader('Cache-Control', 'no-store')
      .setHeader('Content-Type', artifact.contentType)
      .setHeader('X-Content-SHA256', artifact.sha256)
      .send(artifact.bytes);
  }
}
